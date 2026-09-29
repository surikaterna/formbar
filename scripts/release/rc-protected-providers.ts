/** Private process boundaries: publication never shares its environment with isolated audit. */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { withIsolatedSignedAudit } from "./rc-isolated-install";
import { assertPinnedPublishTools } from "./rc-publish-toolchain";
import { rcPackages, rcVersion } from "./rc-reviewed-plan";
import { type ApprovedVersion, verifyExistingSignedVersion, verifyPrepackedSignedVersion } from "./rc-signed-existing";
import { createSignedRegistryReader } from "./rc-signed-reader";

const exec = promisify(execFile);
type PublishCategory =
	| "PRESPAWN_CONFIG"
	| "PRESPAWN_TOOLCHAIN"
	| "PRESPAWN_OIDC"
	| "NPM_STAGE_REQUIRED"
	| "NPM_AUTH_REQUIRED"
	| "NPM_REGISTRY_UNAUTHORIZED"
	| "NPM_REGISTRY_NOT_FOUND"
	| "NPM_CLI_USAGE"
	| "NPM_FORBIDDEN"
	| "NPM_OTP"
	| "NPM_PERMISSION"
	| "NPM_TIMEOUT"
	| "NPM_UNKNOWN";

export class SafePublishFailure extends Error {
	constructor(category: PublishCategory, name: string, elapsedMs: number, npmMs = 0) {
		// The name and version come only from the reviewed plan, never from subprocess output.
		super(
			`npm publish ${category} ${name}@${rcVersion} preflightMs=${Math.min(120_000, Math.max(0, Math.floor(elapsedMs - npmMs)))} npmMs=${Math.min(120_000, Math.max(0, Math.floor(npmMs)))}`,
		);
		this.name = "SafePublishFailure";
	}
}

const npmCodes: Readonly<Record<string, PublishCategory>> = {
	ENEEDAUTH: "NPM_AUTH_REQUIRED",
	E401: "NPM_REGISTRY_UNAUTHORIZED",
	E404: "NPM_REGISTRY_NOT_FOUND",
	EUSAGE: "NPM_CLI_USAGE",
	E_STAGE_REQUIRED: "NPM_STAGE_REQUIRED",
	EOTP: "NPM_OTP",
	E403: "NPM_FORBIDDEN",
	EACCES: "NPM_PERMISSION",
	EPERM: "NPM_PERMISSION",
};

export function npmCategory(error: unknown): PublishCategory {
	if (!error || typeof error !== "object") return "NPM_UNKNOWN";
	const record = error as { code?: unknown; killed?: unknown; stderr?: unknown };
	if (record.code === "ETIMEDOUT" || record.killed === true) return "NPM_TIMEOUT";
	if (
		typeof record.code !== "number" ||
		!Number.isInteger(record.code) ||
		record.code === 0 ||
		typeof record.stderr !== "string"
	)
		return "NPM_UNKNOWN";
	let category: PublishCategory | undefined;
	let seenCode: string | undefined;
	for (const line of record.stderr.split("\n")) {
		// Only a complete npm diagnostic line is evidence; prose and URLs are not.
		const diagnostic = /^npm (?:error|ERR!) code(?:[ \t]+(.*))?\r?$/.exec(line);
		if (!diagnostic) continue;
		const code = diagnostic[1]?.replace(/\r$/, "");
		if (!code || !/^[A-Z0-9_]{1,32}$/.test(code) || !Object.prototype.hasOwnProperty.call(npmCodes, code))
			return "NPM_UNKNOWN";
		if (seenCode && seenCode !== code) return "NPM_UNKNOWN";
		seenCode = code;
		category = npmCodes[code];
	}
	return category ?? "NPM_UNKNOWN";
}

function safeName(name: string): string {
	return rcPackages.some((entry) => name === `@formbar/${entry}`) ? name : "UNREVIEWED_PACKAGE";
}
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

async function publishPreflight(name: string, elapsed: () => number) {
	let node: string;
	let npm: string;
	try {
		({ node, npm } = protectedTools());
	} catch {
		throw new SafePublishFailure("PRESPAWN_CONFIG", safeName(name), elapsed());
	}
	try {
		await assertPinnedPublishTools(node, npm);
	} catch {
		throw new SafePublishFailure("PRESPAWN_TOOLCHAIN", safeName(name), elapsed());
	}
	try {
		assertOidcOnly();
	} catch {
		throw new SafePublishFailure("PRESPAWN_OIDC", safeName(name), elapsed());
	}
	return { node, npm };
}

async function preparePublish(dir: string, name: string, bytes: Buffer): Promise<string> {
	const tar = join(dir, `${name.slice(9)}.tgz`);
	await writeFile(tar, bytes, { flag: "wx", mode: 0o600 });
	await writeFile(join(dir, ".userconfig"), "", { flag: "wx", mode: 0o600 });
	await writeFile(join(dir, ".globalconfig"), "", { flag: "wx", mode: 0o600 });
	if (!Buffer.from(await readFile(tar)).equals(bytes)) throw new Error("tarball drift");
	return tar;
}

async function execPublish(node: string, npm: string, dir: string, tar: string): Promise<void> {
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
			"--ignore-scripts",
			"--fetch-retries=0",
			"--registry=https://registry.npmjs.org/",
			`--userconfig=${join(dir, ".userconfig")}`,
			`--globalconfig=${join(dir, ".globalconfig")}`,
		],
		{ cwd: dir, env: publishEnv(dir), timeout: 120_000, maxBuffer: 100_000 },
	);
}

export async function publishProtected(name: string, bytes: Buffer): Promise<void> {
	const started = Date.now();
	const elapsed = () => Date.now() - started;
	const { node, npm } = await publishPreflight(name, elapsed);
	let dir: string;
	try {
		dir = await mkdtemp(join(tmpdir(), "formbar-rc-publish-"));
	} catch {
		throw new SafePublishFailure("PRESPAWN_CONFIG", safeName(name), elapsed());
	}
	let stage: "prepare" | "npm" = "prepare";
	let npmStarted = 0;
	let failure: SafePublishFailure | undefined;
	try {
		const tar = await preparePublish(dir, name, bytes);
		stage = "npm";
		npmStarted = Date.now();
		await execPublish(node, npm, dir, tar);
	} catch (error) {
		failure = new SafePublishFailure(
			stage === "npm" ? npmCategory(error) : "PRESPAWN_CONFIG",
			safeName(name),
			elapsed(),
			stage === "npm" ? Date.now() - npmStarted : 0,
		);
	} finally {
		try {
			await rm(dir, { recursive: true, force: true });
		} catch {
			failure ??= new SafePublishFailure("NPM_UNKNOWN", safeName(name), elapsed());
		}
	}
	if (failure) throw failure;
}
