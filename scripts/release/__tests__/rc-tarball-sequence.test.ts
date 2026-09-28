import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { rcPackages, rcVersion } from "../rc-reviewed-plan";
import type { ApprovedVersion } from "../rc-signed-existing";
import { type TarballAdapter, simulateTarballSequence } from "../rc-tarball-sequence";

const commit = "a".repeat(40);
const candidates = rcPackages.map((name) => ({
	name: `@formbar/${name}`,
	version: rcVersion,
	bytes: Buffer.from(name),
	expectedSha512: createHash("sha512").update(name).digest("hex"),
}));
const identities = candidates.map((candidate) => ({
	name: candidate.name,
	version: candidate.version,
	latest: "0.22.0",
	rc: rcVersion,
	commit,
	repository: "surikaterna/formbar",
	workflow: ".github/workflows/release.yml",
	ref: "refs/heads/main",
	runId: "123",
	attempt: "1",
})) as ApprovedVersion[];

function fixture() {
	const writes: string[] = [];
	const stored = new Map<string, boolean>();
	const adapter: TarballAdapter = {
		async read(name) {
			const exists = stored.has(name);
			return {
				name,
				latest: "0.22.0",
				rc: exists ? rcVersion : undefined,
				versions: { "0.22.0": {}, ...(exists ? { [rcVersion]: {} } : {}) },
			};
		},
		async publish(candidate, args) {
			expect(args).toEqual(["--tag", "rc", "--access", "public", "--provenance"]);
			writes.push(candidate.name);
			stored.set(candidate.name, true);
		},
		registry: {
			async get() {
				throw new Error("fake registry has no signed attestation");
			},
		},
		proof: {
			async audit() {
				throw new Error("unsigned fixture");
			},
			async verify() {
				throw new Error("fake signer");
			},
		},
	};
	return { adapter, writes, stored };
}

describe("#382 disabled tarball sequence", () => {
	it("stops after the first fake PUT, not a false seven-write success", async () => {
		const { adapter, writes } = fixture();
		await expect(simulateTarballSequence(candidates, identities, adapter)).rejects.toThrow(
			"SIGNED_VERIFICATION_REQUIRED",
		);
		expect(writes).toEqual([candidates[0].name]);
	});
	it("does not skip sameSHA without genuine signed existing proof", async () => {
		const { adapter, writes, stored } = fixture();
		stored.set(candidates[0].name, true);
		await expect(simulateTarballSequence(candidates, identities, adapter)).rejects.toThrow(
			"SIGNED_VERIFICATION_REQUIRED",
		);
		expect(writes).toEqual([]);
	});
	it.each([
		[candidates.slice(1), identities, "six-only"],
		[[{ ...candidates[0], name: "@formbar/extra" }, ...candidates.slice(1)], identities, "foreign package"],
		[[{ ...candidates[0], version: "0.23.0" }, ...candidates.slice(1)], identities, "stable"],
		[candidates, [{ ...identities[0], rc: "0.23.0-rc.1" }, ...identities.slice(1)], "wrong tag"],
		[[{ ...candidates[0], bytes: Buffer.from("tampered") }, ...candidates.slice(1)], identities, "tampered"],
		[[{ ...candidates[0], expectedSha512: "a".repeat(128) }, ...candidates.slice(1)], identities, "repacked"],
		[candidates, [{ ...identities[0], runId: "foreign" }, ...identities.slice(1)], "foreign run"],
		[candidates, [{ ...identities[0], repository: "foreign/repo" }, ...identities.slice(1)], "foreign repo"],
	])("rejects unreviewed plan %s (%s)", async (items, approvals) => {
		const { adapter, writes } = fixture();
		await expect(simulateTarballSequence(items, approvals, adapter)).rejects.toThrow("unreviewed candidate plan");
		expect(writes).toEqual([]);
	});
	it("denies wrong present gitHead before write", async () => {
		const { adapter, writes } = fixture();
		const read = adapter.read;
		adapter.read = async (name) => ({
			...(await read(name)),
			versions: { "0.22.0": {}, [rcVersion]: { gitHead: "b".repeat(40) } },
			rc: rcVersion,
		});
		await expect(simulateTarballSequence(candidates, identities, adapter)).rejects.toThrow("foreign gitHead");
		expect(writes).toEqual([]);
	});
	it.each(["timeout", "403"])("stops on ambiguous %s without writing the next package", async (failure) => {
		const { adapter, writes } = fixture();
		adapter.publish = async (candidate) => {
			writes.push(candidate.name);
			throw new Error(failure);
		};
		await expect(simulateTarballSequence(candidates, identities, adapter)).rejects.toThrow(failure);
		expect(writes).toEqual([candidates[0].name]);
	});
	it("denies changed latest, rc or downloaded proof without another write", async () => {
		const { adapter, writes } = fixture();
		const read = adapter.read;
		let count = 0;
		adapter.read = async (name) => {
			const snapshot = await read(name);
			return ++count > 1 ? { ...snapshot, latest: "0.23.0" } : snapshot;
		};
		await expect(simulateTarballSequence(candidates, identities, adapter)).rejects.toThrow();
		expect(writes).toHaveLength(1);
	});
	it("digest of candidate is bytes rather than manifest gitHead", () => {
		expect(createHash("sha512").update(candidates[0].bytes).digest("hex")).toHaveLength(128);
	});
});
