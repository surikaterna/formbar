/** Private process boundaries: publication never shares its environment with isolated audit. */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { withIsolatedSignedAudit } from "./rc-isolated-install";
import { assertPinnedPublishTools } from "./rc-publish-toolchain";
import { type ApprovedVersion, verifyExistingSignedVersion, verifyPrepackedSignedVersion } from "./rc-signed-existing";
import { createSignedRegistryReader } from "./rc-signed-reader";

const exec = promisify(execFile);
export function protectedTools() {
	const node = process.env.RC_NODE_BINARY;
	const npm = process.env.RC_NPM_ROOT;
	if (!node || !npm || !node.startsWith("/") || !npm.startsWith("/"))
		throw new Error("pinned absolute RC_NODE_BINARY and RC_NPM_ROOT required");
	return { node, npm };
}

export async function signedPublished(approved: ApprovedVersion, bytes: Buffer, sha512: string): Promise<void> {
	const { node, npm } = protectedTools();
	const verdict = await withIsolatedSignedAudit(approved.name, approved.version, node, npm, async (proof) => {
		const existing = await verifyExistingSignedVersion(createSignedRegistryReader(), proof, approved);
		const prepacked = await verifyPrepackedSignedVersion(createSignedRegistryReader(), proof, approved, bytes);
		return { existing, prepacked };
	});
	if (
		verdict.existing.status !== "VERIFIED_EXISTING" ||
		verdict.prepacked.status !== "VERIFIED_EXISTING" ||
		verdict.existing.sha512 !== sha512 ||
		verdict.prepacked.sha512 !== sha512
	)
		throw new Error("existing signed version or prepacked bytes UNVERIFIABLE");
}

function assertOidcOnly(): void {
	if (
		existsSync(join(process.cwd(), ".npmrc")) ||
		Object.entries(process.env).some(
			([key, value]) =>
				Boolean(value) &&
				(/^(NPM_TOKEN|NODE_AUTH_TOKEN|GH_TOKEN|NPM_ID_TOKEN|SIGSTORE_ID_TOKEN)$/i.test(key) ||
					(/^npm_config_/i.test(key) && /auth|token|password|provenancefile/i.test(key))),
		)
	)
		throw new Error("ambient npm credentials/config forbidden");
	if (
		process.env.GITHUB_ACTIONS !== "true" ||
		!process.env.ACTIONS_ID_TOKEN_REQUEST_URL ||
		!process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
	)
		throw new Error("GitHub Actions OIDC request unavailable");
}

function publishEnv(dir: string) {
	return {
		PATH: process.env.PATH ?? "",
		HOME: dir,
		TMPDIR: dir,
		GITHUB_ACTIONS: "true",
		GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY ?? "",
		GITHUB_SERVER_URL: process.env.GITHUB_SERVER_URL ?? "",
		GITHUB_WORKFLOW_REF: process.env.GITHUB_WORKFLOW_REF ?? "",
		GITHUB_SHA: process.env.GITHUB_SHA ?? "",
		GITHUB_RUN_ID: process.env.GITHUB_RUN_ID ?? "",
		GITHUB_RUN_ATTEMPT: process.env.GITHUB_RUN_ATTEMPT ?? "",
		GITHUB_REF: process.env.GITHUB_REF ?? "",
		GITHUB_WORKFLOW: process.env.GITHUB_WORKFLOW ?? "",
		ACTIONS_ID_TOKEN_REQUEST_URL: process.env.ACTIONS_ID_TOKEN_REQUEST_URL ?? "",
		ACTIONS_ID_TOKEN_REQUEST_TOKEN: process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN ?? "",
	};
}

export async function publishProtected(name: string, bytes: Buffer): Promise<void> {
	const { node, npm } = protectedTools();
	await assertPinnedPublishTools(node, npm);
	assertOidcOnly();
	const dir = await mkdtemp(join(tmpdir(), "formbar-rc-publish-"));
	try {
		const tar = join(dir, `${name.slice(9)}.tgz`);
		const user = join(dir, ".userconfig");
		const global = join(dir, ".globalconfig");
		await writeFile(tar, bytes, { flag: "wx", mode: 0o600 });
		await writeFile(user, "", { flag: "wx", mode: 0o600 });
		await writeFile(global, "", { flag: "wx", mode: 0o600 });
		if (!Buffer.from(await readFile(tar)).equals(bytes)) throw new Error("tarball drift");
		await exec(
			node,
			[
				join(npm, "bin/npm-cli.js"),
				"publish",
				tar,
				"--tag",
				"rc",
				"--access",
				"public",
				"--provenance",
				"--registry=https://registry.npmjs.org/",
				`--userconfig=${user}`,
				`--globalconfig=${global}`,
			],
			{ cwd: dir, env: publishEnv(dir), timeout: 120_000, maxBuffer: 100_000 },
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}
