/** Public, credential-free exact-version install for #374; never reuses publish OIDC. */
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createPinnedAudit } from "./rc-signed-audit";
import type { AuditProof } from "./rc-signed-existing";

const exec = promisify(execFile);

/** A fresh directory, exact single root dependency and no inherited npm/GitHub credentials. */
export async function withIsolatedSignedAudit<T>(
	name: string,
	version: string,
	nodeBinary: string,
	npmRoot: string,
	verify: (proof: AuditProof) => Promise<T>,
): Promise<T> {
	const directory = await mkdtemp(join(tmpdir(), "formbar-rc-audit-"));
	try {
		await writeFile(
			join(directory, "package.json"),
			JSON.stringify({ private: true, dependencies: { [name]: version } }),
		);
		await writeFile(join(directory, ".npm-globalrc"), "");
		const proof = await createPinnedAudit(nodeBinary, npmRoot, directory);
		const env = {
			PATH: process.env.PATH ?? "",
			HOME: directory,
			TMPDIR: directory,
			npm_config_userconfig: "/dev/null",
			npm_config_globalconfig: join(directory, ".npm-globalrc"),
		};
		await exec(
			nodeBinary,
			[
				join(npmRoot, "bin/npm-cli.js"),
				"install",
				"--ignore-scripts",
				"--no-audit",
				"--no-fund",
				"--package-lock=false",
				"--registry=https://registry.npmjs.org/",
				"--fetch-retries=0",
			],
			{ cwd: directory, env, timeout: 90_000, maxBuffer: 1_000_000 },
		);
		return await verify(proof);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
