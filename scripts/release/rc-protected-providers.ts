/** Private process boundaries: publication never shares its environment with isolated audit. */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { withIsolatedSignedAudit } from "./rc-isolated-install";
import { type NpmDiagnostic, credentialValues, npmDiagnostics } from "./rc-npm-diagnostics";
import { type PublicMetadata, publicMetadata } from "./rc-public-metadata";
import { assertPinnedPublishTools } from "./rc-publish-toolchain";
import { rcPackages, rcVersion } from "./rc-reviewed-plan";
import { type ApprovedVersion, verifyExistingSignedVersion, verifyPrepackedSignedVersion } from "./rc-signed-existing";
import { createSignedRegistryReader } from "./rc-signed-reader";

const exec = promisify(execFile);
type PublishCategory =
	| "PRESPAWN_CONFIG"
	| "PRESPAWN_TOOLCHAIN"
	| "PRESPAWN_OIDC"
	| "PRESPAWN_METADATA"
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
	constructor(
		category: PublishCategory,
		name: string,
		elapsedMs: number,
		npmMs = 0,
		stdoutBytes = 0,
		stderrBytes = 0,
		diagnostics: NpmDiagnostic | "" = "",
	) {
		// The name and version come only from the reviewed plan, never from subprocess output.
		super(
			`npm publish ${category} ${safeName(name)}@${rcVersion} preflightMs=${boundedNumber(elapsedMs - npmMs, 120_000)} npmMs=${boundedNumber(npmMs, 120_000)} stdoutBytes=${boundedNumber(stdoutBytes, 100_000)} stderrBytes=${boundedNumber(stderrBytes, 100_000)}${diagnostics ? `\n[npm diagnostic] ${diagnostics}` : ""}`,
		);
		this.name = "SafePublishFailure";
	}
}

function boundedNumber(value: number, limit: number): number {
	return Number.isFinite(value) ? Math.min(limit, Math.max(0, Math.floor(value))) : 0;
}

// #428's npm 11 line-code allowlist; no distinct verified OIDC/trusted-publisher code exists here.
// JSON is opportunistic captured output only: the publish CLI flags remain unchanged (no --json).
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

function capturedBytes(value: unknown): number {
	return typeof value === "string" ? Buffer.byteLength(value) : Buffer.isBuffer(value) ? value.byteLength : 0;
}

function structuredCode(output: string): string | undefined | null {
	if (Buffer.byteLength(output) > 100_000) return null;
	// JSON-looking output blocks competing codes even when its envelope is invalid; ordinary notices do not.
	if (!/^(?:[\[{"\-0-9]|true\b|false\b|null\b)/.test(output.trimStart())) return undefined;
	// Duplicate JSON keys can mask conflicting codes after JSON.parse; reject rather than trust last-wins parsing.
	if (
		output.includes("\\") ||
		(output.match(/"code"\s*:/g) ?? []).length !== 1 ||
		(output.match(/"error"\s*:/g) ?? []).length !== 1
	)
		return null;
	try {
		const parsed: unknown = JSON.parse(output);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
		const record = parsed as Record<string, unknown>;
		if (!record.error || typeof record.error !== "object" || Array.isArray(record.error)) return null;
		const detail = record.error as Record<string, unknown>;
		if (
			Object.keys(record).some((key) => key !== "error") ||
			Object.keys(detail).some((key) => key !== "code" && key !== "summary" && key !== "detail")
		)
			return null;
		return typeof detail.code === "string" ? detail.code : null;
	} catch {
		return null;
	}
}

function diagnosticCodes(output: string): string[] | null {
	if (Buffer.byteLength(output) > 100_000) return null;
	const codes: string[] = [];
	for (const line of output.split("\n")) {
		const diagnostic = /^npm (?:error|ERR!) code(?:[ \t]+(.*))?\r?$/.exec(line);
		if (diagnostic) codes.push(diagnostic[1]?.replace(/\r$/, "") ?? "");
	}
	return codes;
}

export function npmCategory(error: unknown): PublishCategory {
	if (!error || typeof error !== "object") return "NPM_UNKNOWN";
	const record = error as { code?: unknown; killed?: unknown; signal?: unknown; stdout?: unknown; stderr?: unknown };
	if (record.code === "ETIMEDOUT" || record.killed === true) return "NPM_TIMEOUT";
	if (
		typeof record.code !== "number" ||
		!Number.isInteger(record.code) ||
		record.code === 0 ||
		record.signal != null ||
		(record.stdout != null && typeof record.stdout !== "string") ||
		(record.stderr != null && typeof record.stderr !== "string")
	)
		return "NPM_UNKNOWN";
	const stdout = record.stdout ?? "";
	const stderr = record.stderr ?? "";
	const outputs = [stdout, stderr] as string[];
	const lines = diagnosticCodes(stderr);
	if (lines === null || Buffer.byteLength(stdout) > 100_000) return "NPM_UNKNOWN";
	const codes = [...lines];
	for (const output of outputs) {
		const code = structuredCode(output);
		if (code === null) return "NPM_UNKNOWN";
		if (code !== undefined) codes.push(code);
	}
	if (!codes.length || codes.some((code) => !/^[A-Z0-9_]{1,32}$/.test(code) || !Object.hasOwn(npmCodes, code)))
		return "NPM_UNKNOWN";
	return codes.every((code) => code === codes[0]) ? npmCodes[codes[0]] : "NPM_UNKNOWN";
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

function publishEnv(dir: string, metadata: PublicMetadata) {
	return {
		...metadata,
		PATH: process.env.PATH ?? "",
		HOME: dir,
		TMPDIR: dir,
		GITHUB_ACTIONS: "true",
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
	let metadata: PublicMetadata;
	try {
		metadata = publicMetadata(process.env);
	} catch {
		throw new SafePublishFailure("PRESPAWN_METADATA", safeName(name), elapsed());
	}
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
	return { node, npm, metadata };
}

async function preparePublish(dir: string, name: string, bytes: Buffer): Promise<string> {
	const tar = join(dir, `${name.slice(9)}.tgz`);
	await writeFile(tar, bytes, { flag: "wx", mode: 0o600 });
	await writeFile(join(dir, ".userconfig"), "", { flag: "wx", mode: 0o600 });
	await writeFile(join(dir, ".globalconfig"), "", { flag: "wx", mode: 0o600 });
	if (!Buffer.from(await readFile(tar)).equals(bytes)) throw new Error("tarball drift");
	return tar;
}

async function execPublish(
	node: string,
	npm: string,
	dir: string,
	tar: string,
	metadata: PublicMetadata,
): Promise<void> {
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
		{ cwd: dir, env: publishEnv(dir, metadata), timeout: 120_000, maxBuffer: 100_000 },
	);
}

export async function publishProtected(name: string, bytes: Buffer): Promise<void> {
	const started = Date.now();
	const elapsed = () => Date.now() - started;
	const { node, npm, metadata } = await publishPreflight(name, elapsed);
	let dir: string;
	try {
		dir = await mkdtemp(join(tmpdir(), "formbar-rc-publish-"));
	} catch {
		throw new SafePublishFailure("PRESPAWN_CONFIG", safeName(name), elapsed());
	}
	let stage: "prepare" | "npm" = "prepare";
	const secrets = credentialValues(process.env);
	let npmStarted = 0;
	let failure: SafePublishFailure | undefined;
	try {
		const tar = await preparePublish(dir, name, bytes);
		stage = "npm";
		npmStarted = Date.now();
		await execPublish(node, npm, dir, tar, metadata);
	} catch (error) {
		failure = new SafePublishFailure(
			stage === "npm" ? npmCategory(error) : "PRESPAWN_CONFIG",
			safeName(name),
			elapsed(),
			stage === "npm" ? Date.now() - npmStarted : 0,
			stage === "npm" && error && typeof error === "object" ? capturedBytes((error as { stdout?: unknown }).stdout) : 0,
			stage === "npm" && error && typeof error === "object" ? capturedBytes((error as { stderr?: unknown }).stderr) : 0,
			stage === "npm" ? npmDiagnostics(error, secrets) : "",
		);
	} finally {
		try {
			await rm(dir, { recursive: true, force: true });
		} catch {
			failure ??= new SafePublishFailure(
				"NPM_UNKNOWN",
				safeName(name),
				elapsed(),
				0,
				0,
				0,
				npmDiagnostics({ code: "CLEANUP_FAILED" }, []),
			);
		}
	}
	if (failure) throw failure;
}
