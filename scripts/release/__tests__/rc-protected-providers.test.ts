import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../rc-publish-toolchain", () => ({ assertPinnedPublishTools: vi.fn() }));
import { npmCategory, publishProtected } from "../rc-protected-providers";

const original = { ...process.env };
const fixtures: string[] = [];
afterEach(() => {
	process.env = { ...original };
	for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fakeNpm(stderr: string, exit: number, stdout = ""): { root: string; calls: string } {
	const root = mkdtempSync(join(tmpdir(), "rc-fake-npm-"));
	fixtures.push(root);
	mkdirSync(join(root, "bin"));
	const calls = join(root, "calls");
	writeFileSync(
		join(root, "bin/npm-cli.js"),
		`require('node:fs').appendFileSync(${JSON.stringify(calls)}, 'attempt\\n'); process.stdout.write(${JSON.stringify(stdout)}); process.stderr.write(${JSON.stringify(stderr)}); process.exit(${exit});`,
	);
	process.env = {
		...original,
		RC_NODE_BINARY: process.execPath,
		RC_NPM_ROOT: root,
		GITHUB_ACTIONS: "true",
		ACTIONS_ID_TOKEN_REQUEST_URL: "https://secret.invalid/oidc?token=secret-oidc",
		ACTIONS_ID_TOKEN_REQUEST_TOKEN: "secret-oidc",
	};
	return { root, calls };
}

describe("production-only npm boundary", () => {
	it("classifies forced timeout independently of secret-bearing stderr and unknown spawn failures", () => {
		expect(npmCategory({ killed: true, code: null, stderr: "secret-otp" })).toBe("NPM_TIMEOUT");
		expect(npmCategory({ code: "ETIMEDOUT", stderr: "secret" })).toBe("NPM_TIMEOUT");
		expect(npmCategory({ code: "ENOENT", stderr: "npm error code E_STAGE_REQUIRED secret" })).toBe("NPM_UNKNOWN");
	});
	it.each([
		"npm error code E401\nnpm error code E404",
		"npm error code EACCES\nnpm error code EPERM",
		"npm error code E401\nnpm error code E401 extra",
		"npm error code E401\nnpm ERR! code unknown",
		"npm error code E401\nnpm error code",
		"npm error code E401\nnpm error code E401;secret",
		"npm error code e401",
		"npm error code E401 https://user:secret@registry.invalid/",
		"npm error code E999",
		"https://registry.invalid/npm%20error%20code%20E401",
		"npm error OIDC trusted publisher failed; ENEEDAUTH",
		"npm ERR! 403 Forbidden; E_STAGE_REQUIRED",
	])("rejects ambiguous, malformed and prose-only diagnostics", (stderr) => {
		expect(npmCategory({ code: 1, stderr })).toBe("NPM_UNKNOWN");
	});
	it("requires numeric nonzero exit and string stderr; ignores stdout and spawn output", () => {
		for (const code of [0, "1", null, Number.NaN, 1.5]) {
			expect(npmCategory({ code, stderr: "npm error code E401" })).toBe("NPM_UNKNOWN");
		}
		expect(npmCategory({ code: 1, stdout: "npm error code E401", stderr: "opaque" })).toBe("NPM_UNKNOWN");
		expect(npmCategory({ code: 1, stderr: Buffer.from("npm error code E401") })).toBe("NPM_UNKNOWN");
		expect(npmCategory({ code: 1, stderr: "npm error code E401\r\nnpm ERR! code E401\r\n" })).toBe(
			"NPM_REGISTRY_UNAUTHORIZED",
		);
	});
	// Modeled npm 11.20.0-shaped failure payloads, not observed CLI --json output: no --json flag was run or added.
	it.each([
		[{ error: { code: "ENEEDAUTH", summary: "secret-token" } }, "NPM_AUTH_REQUIRED"],
		[{ error: { code: "E_STAGE_REQUIRED" } }, "NPM_STAGE_REQUIRED"],
		[{ error: { code: "EPROVENANCE" } }, "NPM_UNKNOWN"],
		[{ error: { code: "E401", extra: "secret-token" } }, "NPM_UNKNOWN"],
		[{ error: { code: 401 } }, "NPM_UNKNOWN"],
		[{ error: { code: "E401" }, code: "E404" }, "NPM_UNKNOWN"],
	])("classifies only allowlisted structured codes, not arbitrary fields", (payload, category) => {
		expect(npmCategory({ code: 1, stdout: JSON.stringify(payload), stderr: "" })).toBe(category);
	});
	it("rejects malformed, conflicting, oversized and stdout-prose codes", () => {
		for (const stdout of [
			'{"error":{"code":"E401"',
			'{"error":{"code":"E401"}} trailing',
			"npm error code E401",
			"x".repeat(100_001),
		]) {
			expect(npmCategory({ code: 1, stdout, stderr: "" })).toBe("NPM_UNKNOWN");
		}
		expect(npmCategory({ code: 1, stdout: '{"error":{"code":"E401"}}', stderr: "npm error code E404" })).toBe(
			"NPM_UNKNOWN",
		);
		expect(npmCategory({ code: 1, stdout: '{"error":{"code":"E401"}}', stderr: "x".repeat(100_001) })).toBe(
			"NPM_UNKNOWN",
		);
		expect(npmCategory({ code: 1, signal: "SIGTERM", stderr: "npm error code E401" })).toBe("NPM_UNKNOWN");
		expect(npmCategory({ code: 1, stdout: '{"error":{"code":"E401","code":"E404"}}' })).toBe("NPM_UNKNOWN");
		expect(npmCategory({ code: 1, stdout: '{"error":{"code":"E401","\\u0063ode":"E404"}}' })).toBe("NPM_UNKNOWN");
		expect(npmCategory({ code: 0, stdout: '{"error":{"code":"E401"}}' })).toBe("NPM_UNKNOWN");
	});
	it.each([
		'[ {"error":{"code":"E404"}} ]',
		'[ {"error":{"code":"E404"}}',
		'"E404"',
		"null",
		"true",
		"42",
		'{"message":"npm notice"}',
		'{"error":null}',
		'{"error":{"code":"E404"},"extra":true}',
		'{"error":{"code":"E404","code":"E401"}}',
	])("rejects unsupported or malformed structured stdout even with a valid stderr code: %s", (stdout) => {
		expect(npmCategory({ code: 1, stdout, stderr: "npm error code E401" })).toBe("NPM_UNKNOWN");
	});
	it.each(["npm notice", "npm notice Publishing to https://registry.npmjs.org/", "opaque diagnostic prose"])(
		"allows an anchored stderr code with ordinary non-JSON stdout: %s",
		(stdout) => {
			expect(npmCategory({ code: 1, stdout, stderr: "npm error code E401" })).toBe("NPM_REGISTRY_UNAUTHORIZED");
		},
	);
	it.each([
		["no GitHub OIDC", {}],
		["injected npm bearer", { NPM_TOKEN: "fake" }],
		["injected OIDC bearer", { NPM_ID_TOKEN: "fake" }],
		["injected npm auth config", { npm_config__authToken: "fake" }],
	])("denies %s before spawning publish", async (_, extra) => {
		process.env = {
			...original,
			RC_NODE_BINARY: "/nonexistent/pinned-node",
			RC_NPM_ROOT: "/nonexistent/pinned-npm",
			GITHUB_ACTIONS: "true",
			ACTIONS_ID_TOKEN_REQUEST_URL: "https://example.invalid/oidc",
			ACTIONS_ID_TOKEN_REQUEST_TOKEN: "fake-request-token",
			...extra,
		};
		if (_ === "no GitHub OIDC") process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = "";
		await expect(publishProtected("@formbar/expressions", Buffer.from("fixture"))).rejects.toThrow();
	});

	it.each([
		["ENEEDAUTH", "npm error code ENEEDAUTH", "NPM_AUTH_REQUIRED"],
		["E401", "npm error code E401", "NPM_REGISTRY_UNAUTHORIZED"],
		["E404", "npm error code E404", "NPM_REGISTRY_NOT_FOUND"],
		["EUSAGE", "npm error code EUSAGE", "NPM_CLI_USAGE"],
		["E_STAGE_REQUIRED", "npm ERR! code E_STAGE_REQUIRED", "NPM_STAGE_REQUIRED"],
		["E403", "npm ERR! code E403", "NPM_FORBIDDEN"],
		["EOTP", "npm error code EOTP", "NPM_OTP"],
		["EACCES", "npm error code EACCES", "NPM_PERMISSION"],
		["EPERM", "npm error code EPERM", "NPM_PERMISSION"],
		["unknown", "secret-opaque https://user:secret@registry.invalid/", "NPM_UNKNOWN"],
	])("sanitizes fake npm %s without exposing subprocess output", async (_, stderr, category) => {
		const { calls } = fakeNpm(`${stderr}\nnpm error detail https://user:secret@registry.invalid/oidc?token=secret`, 1);
		const before = readdirSync(tmpdir()).filter((name) => name.startsWith("formbar-rc-publish-"));
		let failure: unknown;
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			await publishProtected("@formbar/expressions", Buffer.from("fixture"));
		} catch (error) {
			failure = error;
		}
		const message = String(failure);
		expect(message).toMatch(
			new RegExp(`npm publish ${category} @formbar/expressions@0\\.23\\.0-rc\\.0 preflightMs=\\d+ npmMs=\\d+`),
		);
		expect(message).not.toMatch(/secret|registry\.invalid|opaque|npm ERR|user:/i);
		expect(failure).not.toHaveProperty("cause");
		expect(JSON.stringify(failure)).not.toMatch(/secret|registry\.invalid|user:/i);
		expect((failure as Error).stack).not.toMatch(/secret|registry\.invalid|user:/i);
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
		expect(readFileSync(calls, "utf8")).toBe("attempt\n");
		expect(readdirSync(tmpdir()).filter((name) => name.startsWith("formbar-rc-publish-"))).toEqual(before);
	});

	it("classifies missing OIDC before spawning and without leaking URL", async () => {
		const { calls } = fakeNpm("secret", 1);
		process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = "";
		await expect(publishProtected("@formbar/expressions", Buffer.from("fixture"))).rejects.toThrow(
			/npm publish PRESPAWN_OIDC @formbar\/expressions/,
		);
		expect(() => readFileSync(calls)).toThrow();
	});
	it("redacts secret-bearing structured stdout and stderr while reporting only bounded byte counts", async () => {
		const stdout = JSON.stringify({ error: { code: "E401", summary: "https://user:secret@registry.invalid/token" } });
		const stderr = "npm error code E401\nnpm error detail secret-oidc";
		const { calls } = fakeNpm(stderr, 1, stdout);
		const before = readdirSync(tmpdir()).filter((name) => name.startsWith("formbar-rc-publish-"));
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		let failure: unknown;
		try {
			await publishProtected("@formbar/expressions", Buffer.from("fixture"));
		} catch (error) {
			failure = error;
		} finally {
			spy.mockRestore();
		}
		expect(String(failure)).toMatch(
			new RegExp(
				`npm publish NPM_REGISTRY_UNAUTHORIZED @formbar/expressions@0\\.23\\.0-rc\\.0 preflightMs=\\d+ npmMs=\\d+ stdoutBytes=${Buffer.byteLength(stdout)} stderrBytes=${Buffer.byteLength(stderr)}`,
			),
		);
		expect(String(failure)).not.toMatch(/secret|registry\.invalid|token|https:/i);
		expect(JSON.stringify(failure)).not.toMatch(/secret|registry\.invalid|token|https:/i);
		expect((failure as Error).stack).not.toMatch(/secret|registry\.invalid|token|https:/i);
		expect(failure).not.toHaveProperty("cause");
		expect(spy).not.toHaveBeenCalled();
		expect(readFileSync(calls, "utf8")).toBe("attempt\n");
		expect(readdirSync(tmpdir()).filter((name) => name.startsWith("formbar-rc-publish-"))).toEqual(before);
	});
	it("fails closed on competing JSON stdout while reporting exact bytes without exposing captured text", async () => {
		const stdout = '[{"error":{"code":"E404","detail":"secret-token"}}]';
		const stderr = "npm error code E401\nnpm error detail secret-oidc";
		const { calls } = fakeNpm(stderr, 1, stdout);
		let failure: unknown;
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			await publishProtected("@formbar/expressions", Buffer.from("fixture"));
		} catch (error) {
			failure = error;
		} finally {
			spy.mockRestore();
		}
		expect(String(failure)).toMatch(
			new RegExp(
				`npm publish NPM_UNKNOWN @formbar/expressions@0\\.23\\.0-rc\\.0 preflightMs=\\d+ npmMs=\\d+ stdoutBytes=${Buffer.byteLength(stdout)} stderrBytes=${Buffer.byteLength(stderr)}`,
			),
		);
		expect(String(failure)).not.toMatch(/secret|E404|E401|oidc/i);
		expect(JSON.stringify(failure)).not.toMatch(/secret|E404|E401|oidc/i);
		expect((failure as Error).stack).not.toMatch(/secret|E404|E401|oidc/i);
		expect(failure).not.toHaveProperty("cause");
		expect(spy).not.toHaveBeenCalled();
		expect(readFileSync(calls, "utf8")).toBe("attempt\n");
	});
});
