/** #374: opt-in, local isolated npm audit + independently pinned Sigstore verifier. */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { AuditProof } from "./rc-signed-existing";

const exec = promisify(execFile);
const expectedNode = "v22.23.2";
const expectedNpm = "11.20.0";

async function installedOnly(cwd: string, name: string, version: string) {
	const root = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
	const installed = JSON.parse(await readFile(join(cwd, "node_modules", name, "package.json"), "utf8"));
	if (
		root.dependencies?.[name] !== version ||
		Object.keys(root.dependencies).length !== 1 ||
		root.devDependencies ||
		root.optionalDependencies ||
		root.peerDependencies ||
		installed.name !== name ||
		installed.version !== version
	)
		throw new Error("not isolated exact install");
}

/** npmRoot is the absolute directory containing pinned npm's package.json, not an npm executable from PATH. */
export async function createPinnedAudit(nodeBinary: string, npmRoot: string, cwd: string): Promise<AuditProof> {
	const pkg = JSON.parse(await readFile(join(npmRoot, "package.json"), "utf8"));
	const node = await exec(nodeBinary, ["--version"], { timeout: 5_000, maxBuffer: 1024 });
	if (pkg.name !== "npm" || pkg.version !== expectedNpm || node.stdout.trim() !== expectedNode)
		throw new Error("unsupported toolchain");
	return {
		async audit(name, version) {
			await installedOnly(cwd, name, version);
			const cli = join(npmRoot, "bin", "npm-cli.js");
			const args = [
				cli,
				"audit",
				"signatures",
				"--json",
				"--include-attestations",
				"--userconfig=/dev/null",
				`--globalconfig=${join(cwd, ".npm-globalrc")}`,
				"--registry=https://registry.npmjs.org",
				"--cache",
				join(cwd, ".npm-cache"),
			];
			const env = { PATH: process.env.PATH ?? "", HOME: cwd, TMPDIR: cwd };
			const { stdout } = await exec(nodeBinary, args, { cwd, env, timeout: 90_000, maxBuffer: 8_000_000 });
			return { version: expectedNpm, exit: 0, json: JSON.parse(stdout) };
		},
		async verify(bundle, policy) {
			const source = JSON.stringify(bundle);
			const options = JSON.stringify({
				...policy,
				certificateOIDs: Object.fromEntries(
					Object.entries(policy.certificateOIDs).map(([key, value]) => [key, value.toString("base64")]),
				),
			});
			if (source.length + options.length > 60_000) throw new Error("oversized attestation");
			const worker = join(dirname(fileURLToPath(import.meta.url)), "rc-signed-sigstore.cjs");
			await exec(
				nodeBinary,
				[worker, npmRoot, Buffer.from(source).toString("base64"), Buffer.from(options).toString("base64")],
				{
					cwd,
					timeout: 45_000,
					maxBuffer: 16_000,
					env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? cwd, TMPDIR: cwd },
				},
			);
		},
	};
}
