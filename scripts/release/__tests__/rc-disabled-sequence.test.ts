import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	refresh: vi.fn(),
	claim: vi.fn(),
	bytes: vi.fn(),
	source: vi.fn(),
	observe: vi.fn(),
	github: vi.fn(),
	signedReader: vi.fn(),
	install: vi.fn(),
	verify: vi.fn(),
	pinned: vi.fn(),
}));
vi.mock("../rc-run-authority", () => ({ refreshVerifiedRun: mocks.refresh, claimVerifiedRun: mocks.claim }));
vi.mock("../rc-prepacked-candidates", () => ({ verifiedCandidateBytes: mocks.bytes }));
vi.mock("../rc-pack-evidence", () => ({ loadRcSource: mocks.source }));
vi.mock("../rc-live-reads", () => ({
	inspectLiveRc: mocks.observe,
	createRegistryGitHubReader: mocks.github,
}));
vi.mock("../rc-signed-reader", () => ({ createSignedRegistryReader: mocks.signedReader }));
vi.mock("../rc-isolated-install", () => ({ withIsolatedSignedAudit: mocks.install }));
vi.mock("../rc-signed-existing", () => ({ verifyPrepackedSignedVersion: mocks.verify }));
vi.mock("../rc-publish-toolchain", () => ({ assertPinnedPublishTools: mocks.pinned }));

import { traceDisabledRc } from "../rc-disabled-sequence";
import type { PrepackedCandidate } from "../rc-prepacked-candidates";
import { rcPackages, rcVersion } from "../rc-reviewed-plan";
import type { VerifiedRun } from "../rc-run-authority";
import type { ApprovedVersion } from "../rc-signed-existing";

const run = Object.freeze({}) as VerifiedRun; // Mock-only: real authority rejects this object.
const exec = promisify(execFile);
const sha = "a".repeat(40);
const expectedBytes = new Map(rcPackages.map((name) => [`@formbar/${name}`, Buffer.from(`tarball-${name}`)]));

function bytesFor(name: string): Buffer {
	const bytes = expectedBytes.get(name);
	if (!bytes) throw new Error("invalid mock package");
	return bytes;
}

function fakeCandidates(): PrepackedCandidate[] {
	return rcPackages.map((name) => {
		const pkg = `@formbar/${name}`;
		const bytes = bytesFor(pkg);
		return Object.freeze({
			name: pkg,
			version: rcVersion,
			sha512: createHash("sha512").update(bytes).digest("hex"),
			integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
			shasum: createHash("sha1").update(bytes).digest("hex"),
		}) as PrepackedCandidate;
	});
}

function mockEvidence(present: Set<string>, candidates: PrepackedCandidate[], actions: string[]): void {
	mocks.refresh.mockResolvedValue({ root: "/checked-out-main", sha, tree: "b".repeat(40), runId: 12345 });
	mocks.pinned.mockResolvedValue(undefined);
	let claimed = false;
	mocks.claim.mockImplementation(async () => {
		if (claimed) throw new Error("run already attempted");
		claimed = true;
		return mocks.refresh(run);
	});
	mocks.source.mockReturnValue({ initialLatest: Object.fromEntries(rcPackages.map((name) => [name, "0.22.0"])) });
	mocks.bytes.mockImplementation(async (_run: unknown, candidate: PrepackedCandidate) =>
		Buffer.from(bytesFor(candidate.name)),
	);
	mocks.observe.mockImplementation(async () => ({
		packages: candidates.map((candidate) => ({
			name: candidate.name,
			observation: present.has(candidate.name) ? "PUBLIC_EXISTING_OBSERVED" : "PUBLIC_ABSENT_OBSERVED",
			reason: "public 404 and packument absence only; npm authorization not established",
			local: { integrity: candidate.integrity, shasum: candidate.shasum },
		})),
	}));
	mocks.install.mockImplementation(
		async (_name: string, _version: string, _node: string, _root: string, cb: (proof: unknown) => Promise<unknown>) =>
			cb({ pinned: true }),
	);
	mocks.verify.mockImplementation(
		async (_read: unknown, proof: unknown, approved: ApprovedVersion, bytes: Uint8Array) => {
			actions.push(`signed:${approved.name}`);
			if (
				!present.has(approved.name) ||
				!proof ||
				approved.commit !== sha ||
				approved.runId !== "12345" ||
				approved.ref !== "refs/heads/main" ||
				approved.workflow !== ".github/workflows/release.yml" ||
				approved.latest !== "0.22.0" ||
				approved.rc !== rcVersion ||
				!Buffer.from(bytes).equals(bytesFor(approved.name))
			)
				return { status: "UNVERIFIABLE", reason: "fake cryptographic rejection" };
			return { status: "VERIFIED_EXISTING", sha512: createHash("sha512").update(bytes).digest("hex") };
		},
	);
}

function fakeWriter(present: Set<string>, actions: string[]) {
	return {
		exchange: vi.fn(async (name: string) => {
			actions.push(`exchange:${name}`);
		}),
		publish: vi.fn(async (name: string, path: string, args: readonly string[], cwd: string) => {
			const bytes = await readFile(path);
			expect(bytes).toEqual(expectedBytes.get(name));
			expect(path.startsWith(`${cwd}/`)).toBe(true);
			const userconfig = join(cwd, ".npm-userrc");
			const globalconfig = join(cwd, ".npm-globalrc");
			expect(userconfig).not.toBe(globalconfig);
			for (const config of [userconfig, globalconfig]) {
				expect(await readFile(config, "utf8")).toBe("");
				expect((await stat(config)).mode & 0o777).toBe(0o600);
			}
			expect(args).toEqual([
				"publish",
				path,
				"--tag",
				"rc",
				"--access",
				"public",
				"--provenance",
				"--registry=https://registry.npmjs.org/",
				`--userconfig=${userconfig}`,
				`--globalconfig=${globalconfig}`,
			]);
			actions.push(`PUT:${name}`);
			present.add(name);
		}),
	};
}

function fixture(existing: readonly string[] = [], directory = tmpdir()) {
	vi.resetAllMocks();
	vi.spyOn(process, "cwd").mockReturnValue(directory);
	vi.stubEnv("NPM_TOKEN", undefined);
	vi.stubEnv("NODE_AUTH_TOKEN", undefined);
	const present = new Set(existing);
	const actions: string[] = [];
	const candidates = fakeCandidates();
	mockEvidence(present, candidates, actions);
	const writer = fakeWriter(present, actions);
	return {
		candidates,
		present,
		actions,
		writer,
		settings: {
			githubReadToken: "read-only-gh",
			nodeBinary: "/pinned/node",
			npmRoot: "/pinned/npm",
			writer,
		},
	};
}

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

function assertEffectiveNpmConfigs(
	probes: Record<string, { stdout: string; stderr: string }> | undefined,
	cwd: string,
): void {
	expect(probes).toBeDefined(); // exec rejects on nonzero exit; no result means preflight failed.
	expect(probes?.list.stdout).toContain(`userconfig = "${join(cwd, ".npm-userrc")}"`);
	expect(probes?.user.stdout.trim()).toBe(join(cwd, ".npm-userrc"));
	expect(probes?.global.stdout.trim()).toBe(join(cwd, ".npm-globalrc"));
	for (const output of Object.values(probes ?? {})) {
		expect(output.stderr).toBe("");
		expect(output.stdout).not.toMatch(/_authToken|NPM_TOKEN|double-loading/i);
	}
}

describe("#389 disabled synthetic seven-package sequence; no genuine OIDC/signature or release authority", () => {
	it("traces seven topo writes with a fresh read and independent signed proof before each next PUT", async () => {
		const f = fixture();
		const result = await traceDisabledRc(run, f.candidates, f.settings);
		expect(result).toEqual({
			status: "UNVERIFIABLE",
			completed: rcPackages.map((name) => `@formbar/${name}`),
			reason: "INJECTED_ONLY",
		});
		expect(f.actions).toEqual(
			rcPackages.flatMap((name) => [`exchange:@formbar/${name}`, `PUT:@formbar/${name}`, `signed:@formbar/${name}`]),
		);
		expect(mocks.observe.mock.calls.length).toBeGreaterThan(rcPackages.length * 2);
		expect(mocks.refresh.mock.calls.length).toBeGreaterThan(mocks.observe.mock.calls.length);
		expect(mocks.pinned).toHaveBeenCalledTimes(7);
		expect(mocks.pinned).toHaveBeenCalledWith("/pinned/node", "/pinned/npm");
	});
	it.skipIf(!process.env.RC_SIGNED_NODE || !process.env.RC_SIGNED_NPM_ROOT)(
		"preflights pinned npm effective isolated configs before an intentionally failed writer",
		async () => {
			const node = process.env.RC_SIGNED_NODE;
			const npmRoot = process.env.RC_SIGNED_NPM_ROOT;
			if (!node || !npmRoot) throw new Error("pinned npm required");
			const f = fixture();
			let probes: Record<string, { stdout: string; stderr: string }> | undefined;
			f.writer.publish.mockImplementationOnce(async (_name, _path, args, cwd) => {
				const configArgs = args.slice(8);
				const probe = (...subcommand: string[]) =>
					exec(node, [join(npmRoot, "bin/npm-cli.js"), "config", ...subcommand, ...configArgs], {
						cwd,
						env: { PATH: process.env.PATH ?? "", HOME: cwd, TMPDIR: cwd },
						timeout: 10_000,
					});
				const [list, user, global] = await Promise.all([
					probe("list"),
					probe("get", "userconfig"),
					probe("get", "globalconfig"),
				]);
				probes = { list, user, global };
				throw new Error("intentional preflight-only writer failure; no PUT");
			});
			const result = await traceDisabledRc(run, f.candidates, f.settings);
			expect(f.writer.publish).toHaveBeenCalledTimes(1);
			const [name, path, args, cwd] = f.writer.publish.mock.calls[0];
			expect(name).toBe("@formbar/expressions");
			expect(args.slice(8)).toEqual([
				`--userconfig=${join(cwd, ".npm-userrc")}`,
				`--globalconfig=${join(cwd, ".npm-globalrc")}`,
			]);
			assertEffectiveNpmConfigs(probes, cwd);
			expect(result).toMatchObject({
				status: "STOPPED",
				completed: [],
				uncertain: "@formbar/expressions",
				reason: "SIGNED_UNVERIFIABLE",
			});
			expect(f.actions).not.toContain("PUT:@formbar/expressions");
			for (const file of [path, join(cwd, ".npm-userrc"), join(cwd, ".npm-globalrc")])
				await expect(stat(file)).rejects.toMatchObject({ code: "ENOENT" });
		},
	);
	it("denies an unexpected project npmrc or ambient NPM_TOKEN before exchange", async () => {
		const directory = await mkdtemp(join(tmpdir(), "formbar-rc-npmrc-deny-"));
		try {
			await writeFile(join(directory, ".npmrc"), "registry=https://example.invalid/\n");
			const f = fixture([], directory);
			expect((await traceDisabledRc(run, f.candidates, f.settings)).status).toBe("STOPPED");
			expect(f.writer.exchange).not.toHaveBeenCalled();
			const token = fixture();
			vi.stubEnv("NPM_TOKEN", "forbidden");
			expect((await traceDisabledRc(run, token.candidates, token.settings)).status).toBe("STOPPED");
			expect(token.writer.exchange).not.toHaveBeenCalled();
		} finally {
			vi.restoreAllMocks();
			await rm(directory, { recursive: true, force: true });
		}
	});
	it("skips existing only after signed byte-bound proof without exchange or PUT", async () => {
		const f = fixture(["@formbar/expressions"]);
		const result = await traceDisabledRc(run, f.candidates, f.settings);
		expect(result.status).toBe("UNVERIFIABLE");
		expect(f.actions[0]).toBe("signed:@formbar/expressions");
		expect(f.actions).not.toContain("PUT:@formbar/expressions");
		expect(f.writer.publish).toHaveBeenCalledTimes(6);
	});
	it("refuses a blind retry of a partial run even if evidence becomes available", async () => {
		const f = fixture();
		f.writer.publish.mockRejectedValueOnce(new Error("timeout after PUT"));
		expect((await traceDisabledRc(run, f.candidates, f.settings)).status).toBe("STOPPED");
		const second = await traceDisabledRc(run, f.candidates, f.settings);
		expect(second).toMatchObject({ status: "STOPPED", completed: [], reason: "PREFLIGHT" });
		expect(f.writer.publish).toHaveBeenCalledTimes(1);
	});
	it("records an independently verified first package and uncertain second without a third exchange", async () => {
		const f = fixture();
		const first = f.writer.publish.getMockImplementation();
		if (!first) throw new Error("missing mock publisher");
		f.writer.publish.mockImplementationOnce(first).mockRejectedValueOnce(new Error("E_STAGE_REQUIRED 403"));
		const result = await traceDisabledRc(run, f.candidates, f.settings);
		expect(result).toMatchObject({
			status: "STOPPED",
			completed: ["@formbar/expressions"],
			uncertain: "@formbar/core",
		});
		expect(f.writer.exchange).toHaveBeenCalledTimes(2);
		expect(f.writer.publish).toHaveBeenCalledTimes(2);
	});
	it("rechecks absence after scoped exchange rather than publishing a raced version", async () => {
		const f = fixture();
		const live = mocks.observe.getMockImplementation();
		if (!live) throw new Error("missing mock public reader");
		mocks.observe.mockImplementationOnce(live).mockImplementationOnce(live).mockResolvedValueOnce({ packages: [] });
		const result = await traceDisabledRc(run, f.candidates, f.settings);
		expect(result).toMatchObject({ status: "STOPPED", uncertain: "@formbar/expressions" });
		expect(f.writer.exchange).toHaveBeenCalledTimes(1);
		expect(f.writer.publish).not.toHaveBeenCalled();
	});
	it.each([
		"missing",
		"order",
		"GO",
		"policy",
		"tags",
		"repack",
		"unsigned-existing",
		"ambient-token",
		"wrong-toolchain",
	])("denies first PUT on %s", async (failure) => {
		const f = fixture(failure === "unsigned-existing" ? ["@formbar/expressions"] : []);
		if (failure === "missing") f.candidates.pop();
		if (failure === "order") f.candidates.reverse();
		if (failure === "GO" || failure === "policy") mocks.refresh.mockRejectedValue(new Error("protected run changed"));
		if (failure === "tags") mocks.observe.mockResolvedValue({ packages: [] });
		if (failure === "repack") mocks.bytes.mockResolvedValue(Buffer.from("tampered"));
		if (failure === "unsigned-existing") mocks.verify.mockResolvedValue({ status: "UNVERIFIABLE" });
		if (failure === "ambient-token") vi.stubEnv("NODE_AUTH_TOKEN", "forbidden");
		if (failure === "wrong-toolchain") mocks.pinned.mockRejectedValue(new Error("unsupported npm"));
		const result = await traceDisabledRc(run, f.candidates, f.settings);
		expect(result.status).toBe("STOPPED");
		expect(f.writer.publish).not.toHaveBeenCalled();
	});
	it.each(["403", "stage", "timeout", "unsigned", "late-GO", "rc-drift", "bytes"])(
		"stops a partial release before the next PUT on %s",
		async (failure) => {
			const f = fixture();
			if (["403", "stage", "timeout"].includes(failure))
				f.writer.publish.mockImplementationOnce(async () => {
					throw new Error(failure);
				});
			if (failure === "unsigned")
				mocks.verify
					.mockResolvedValueOnce({ status: "UNVERIFIABLE" })
					.mockResolvedValueOnce({ status: "UNVERIFIABLE" });
			if (failure === "late-GO")
				f.writer.publish.mockImplementationOnce(async (name) => {
					f.present.add(name);
					mocks.refresh.mockRejectedValue(new Error("GO expired"));
				});
			if (failure === "rc-drift")
				f.writer.publish.mockImplementationOnce(async (name) => {
					f.present.add(name);
					mocks.observe.mockRejectedValue(new Error("rc/latest drift"));
				});
			if (failure === "bytes")
				f.writer.publish.mockImplementationOnce(async (name) => {
					f.present.add(name);
					mocks.verify.mockResolvedValue({ status: "UNVERIFIABLE" });
				});
			const result = await traceDisabledRc(run, f.candidates, f.settings);
			expect(result.status).toBe("STOPPED");
			if (failure === "rc-drift") expect(result).toMatchObject({ completed: ["@formbar/expressions"] });
			else expect(result.uncertain).toBe("@formbar/expressions");
			expect(f.writer.publish).toHaveBeenCalledTimes(1);
			expect(f.actions).not.toContain("PUT:@formbar/core");
		},
	);
});
