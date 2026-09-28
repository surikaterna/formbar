/** Disabled #389: native npm11.20 twice-packed bytes bound to a private protected-run capability. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { type PackageAudit, auditPackages } from "../package-artifacts/audit";
import { loadRcSource } from "./rc-pack-evidence";
import { rcPackages, rcVersion } from "./rc-reviewed-plan";
import { type VerifiedRun, refreshVerifiedRun } from "./rc-run-authority";

declare const brand: unique symbol;
export type PrepackedCandidate = {
	readonly [brand]: true;
	readonly name: string;
	readonly version: string;
	readonly sha512: string;
	readonly integrity: string;
	readonly shasum: string;
};
const stored = new WeakMap<object, { run: VerifiedRun; bytes: Buffer }>();

function toolchain(): void {
	const run = (command: string) =>
		execFileSync(command, ["--version"], { encoding: "utf8", timeout: 5_000, maxBuffer: 1024 }).trim();
	if (
		run("node") !== "v22.23.2" ||
		run("npm") !== "11.20.0" ||
		process.env.npm_config_userconfig !== "/dev/null" ||
		process.env.npm_config_globalconfig !== "/dev/null" ||
		process.env.npm_config_offline !== "true" ||
		Object.entries(process.env).some(
			([key, value]) =>
				Boolean(value) &&
				(["NPM_TOKEN", "NODE_AUTH_TOKEN"].includes(key) ||
					(key.toLowerCase().startsWith("npm_config_") &&
						/auth|password|token|userconfig/i.test(key) &&
						!["npm_config_userconfig", "npm_config_globalconfig"].includes(key))),
		)
	)
		throw new Error("pinned unauthenticated offline npm pack required");
}

function compare(first: PackageAudit[], second: PackageAudit[]): Map<string, Buffer> {
	if (first.length !== rcPackages.length || second.length !== rcPackages.length)
		throw new Error("incomplete seven-package packs");
	const output = new Map<string, Buffer>();
	for (const [index, name] of rcPackages.entries()) {
		const expected = `@formbar/${name}`;
		const a = first[index];
		const b = second[index];
		if (
			a?.name !== expected ||
			b?.name !== expected ||
			!a.bytes.length ||
			a.bytes.length > 20_000_000 ||
			!a.bytes.equals(b.bytes) ||
			output.has(expected)
		)
			throw new Error("changed, oversized or nondeterministic native npm pack");
		output.set(expected, Buffer.from(a.bytes));
	}
	return output;
}

/** No injected packer can mint a candidate: native audited pack bytes are copied and kept private. */
export async function prepackProtectedRun(run: VerifiedRun): Promise<readonly PrepackedCandidate[]> {
	const source = await refreshVerifiedRun(run);
	toolchain();
	loadRcSource(source.root, source.sha, source.tree);
	const first = auditPackages(source.root);
	const second = auditPackages(source.root);
	const bytes = compare(first, second);
	await refreshVerifiedRun(run);
	const candidates = rcPackages.map((name) => {
		const packageName = `@formbar/${name}`;
		const packed = bytes.get(packageName);
		if (!packed) throw new Error("missing native npm pack");
		const sha512 = createHash("sha512").update(packed).digest("hex");
		const candidate = Object.freeze({
			name: packageName,
			version: rcVersion,
			sha512,
			integrity: `sha512-${Buffer.from(sha512, "hex").toString("base64")}`,
			shasum: createHash("sha1").update(packed).digest("hex"),
		}) as PrepackedCandidate;
		stored.set(candidate, { run, bytes: packed });
		return candidate;
	});
	return Object.freeze(candidates);
}

/** A future runner must revalidate the same run and cannot substitute a caller-owned buffer. */
export async function verifiedCandidateBytes(run: VerifiedRun, candidate: PrepackedCandidate): Promise<Buffer> {
	const record = candidate && typeof candidate === "object" ? stored.get(candidate) : undefined;
	if (!record || record.run !== run) throw new Error("missing run-bound prepacked candidate");
	await refreshVerifiedRun(run);
	const digest = createHash("sha512").update(record.bytes).digest("hex");
	if (candidate.sha512 !== digest) throw new Error("prepacked candidate bytes changed");
	return Buffer.from(record.bytes);
}
