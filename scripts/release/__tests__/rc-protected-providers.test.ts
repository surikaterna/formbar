import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../rc-publish-toolchain", () => ({ assertPinnedPublishTools: vi.fn() }));
const faults = vi.hoisted(() => ({ cleanup: false }));
vi.mock("node:fs/promises", async (original) => {
	const fs = await original<typeof import("node:fs/promises")>();
	return {
		...fs,
		rm: async (...args: Parameters<typeof fs.rm>) => {
			if (faults.cleanup) throw new Error("private-cleanup-cause");
			return fs.rm(...args);
		},
	};
});
import { npmCategory, publishProtected } from "../rc-protected-providers";
import { assertPinnedPublishTools } from "../rc-publish-toolchain";
import { assertAuthWithheld, authLeakFixtures } from "./rc-auth-leak-fixtures";

const original = { ...process.env };
const fixtures: string[] = [];
afterEach(() => {
	vi.mocked(assertPinnedPublishTools).mockReset();
	faults.cleanup = false;
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
		`require('node:fs').appendFileSync(${JSON.stringify(calls)}, 'attempt\\n'); require('node:fs').writeFileSync(${JSON.stringify(join(root, "env.json"))}, JSON.stringify(process.env)); process.stdout.write(${JSON.stringify(stdout)}); process.stderr.write(${JSON.stringify(stderr)}); process.exit(${exit});`,
	);
	process.env = {
		...original,
		RC_NODE_BINARY: process.execPath,
		RC_NPM_ROOT: root,
		GITHUB_ACTIONS: "true",
		GITHUB_REPOSITORY: "surikaterna/formbar",
		GITHUB_EVENT_NAME: "workflow_dispatch",
		GITHUB_REPOSITORY_ID: "1245476636",
		GITHUB_REPOSITORY_OWNER_ID: "9478205",
		ACTIONS_ID_TOKEN_REQUEST_URL: "https://secret.invalid/oidc?token=secret-oidc",
		ACTIONS_ID_TOKEN_REQUEST_TOKEN: "secret-oidc",
	};
	return { root, calls };
}

describe("production-only npm boundary", () => {
	it("uses the checked immutable snapshot across asynchronous tool preflight", async () => {
		const { root } = fakeNpm("", 0);
		vi.mocked(assertPinnedPublishTools).mockImplementationOnce(async () => {
			process.env.GITHUB_REPOSITORY = "spoof/formbar";
			process.env.GITHUB_EVENT_NAME = "push";
			process.env.GITHUB_REPOSITORY_ID = "spoof";
			process.env.GITHUB_REPOSITORY_OWNER_ID = "spoof";
		});
		await publishProtected("@formbar/expressions", Buffer.from("fixture"));
		expect(JSON.parse(readFileSync(join(root, "env.json"), "utf8"))).toMatchObject({
			GITHUB_REPOSITORY: "surikaterna/formbar",
			GITHUB_EVENT_NAME: "workflow_dispatch",
			GITHUB_REPOSITORY_ID: "1245476636",
			GITHUB_REPOSITORY_OWNER_ID: "9478205",
		});
	});
	it.each(
		["GITHUB_EVENT_NAME", "GITHUB_REPOSITORY_ID", "GITHUB_REPOSITORY_OWNER_ID", "GITHUB_REPOSITORY"].flatMap((key) =>
			[undefined, "", " ", "WORKFLOW_DISPATCH", "spoof", "01245476636", "+9478205", "9478205.0"].map((value) => [
				key,
				value,
			]),
		),
	)("denies invalid public metadata %s=%s without a publish child", async (key, value) => {
		const { calls } = fakeNpm("", 0);
		if (value === undefined) delete process.env[key as string];
		else process.env[key as string] = value;
		await expect(publishProtected("@formbar/expressions", Buffer.from("fixture"))).rejects.toThrow("PRESPAWN_METADATA");
		expect(assertPinnedPublishTools).not.toHaveBeenCalled();
		expect(() => readFileSync(calls)).toThrow();
	});
	it("passes exactly the three public additions and no ambient secrets to the real fake child", async () => {
		const { root } = fakeNpm("", 0);
		process.env.GITHUB_TOKEN = "private-github";
		process.env.SENTINEL_SECRET = "private-sentinel";
		await publishProtected("@formbar/expressions", Buffer.from("fixture"));
		const env = JSON.parse(readFileSync(join(root, "env.json"), "utf8"));
		expect(Object.keys(env).sort()).toEqual(
			[
				"PATH",
				"HOME",
				"TMPDIR",
				"GITHUB_ACTIONS",
				"GITHUB_REPOSITORY",
				"GITHUB_SERVER_URL",
				"GITHUB_WORKFLOW_REF",
				"GITHUB_SHA",
				"GITHUB_RUN_ID",
				"GITHUB_RUN_ATTEMPT",
				"GITHUB_REF",
				"GITHUB_WORKFLOW",
				"ACTIONS_ID_TOKEN_REQUEST_URL",
				"ACTIONS_ID_TOKEN_REQUEST_TOKEN",
				"GITHUB_EVENT_NAME",
				"GITHUB_REPOSITORY_ID",
				"GITHUB_REPOSITORY_OWNER_ID",
			].sort(),
		);
		expect(env).toMatchObject({
			GITHUB_EVENT_NAME: "workflow_dispatch",
			GITHUB_REPOSITORY_ID: "1245476636",
			GITHUB_REPOSITORY_OWNER_ID: "9478205",
		});
		for (const key of ["GITHUB_TOKEN", "GH_TOKEN", "NPM_TOKEN", "NODE_AUTH_TOKEN", "SENTINEL_SECRET"])
			expect(env).not.toHaveProperty(key);
	});
	it("reports cleanup failure without exposing its raw cause", async () => {
		fakeNpm("", 0);
		const before = new Set(readdirSync(tmpdir()).filter((name) => name.startsWith("formbar-rc-publish-")));
		faults.cleanup = true;
		let failure: unknown;
		try {
			await publishProtected("@formbar/expressions", Buffer.from("fixture"));
		} catch (error) {
			failure = error;
		} finally {
			faults.cleanup = false;
		}
		for (const name of readdirSync(tmpdir()).filter(
			(name) => name.startsWith("formbar-rc-publish-") && !before.has(name),
		))
			fixtures.push(join(tmpdir(), name));
		expect(String(failure)).toContain("reason=cleanup-failure");
		expect((failure as Error).stack).not.toContain("private-cleanup-cause");
		expect(failure).not.toHaveProperty("cause");
	});
	it.each([false, true])(
		"redacts hostile exec output on every error surface (controls=%s) and cleans up",
		async (controls) => {
			const secret = "private-application-value";
			const stderr = `npm error config collision ${secret} ${encodeURIComponent(secret)}\nnpm error https://user:private-url@host.invalid/path?token=private-query#private-fragment\nnpm error Authorization: Bearer private-bearer\nnpm error ghp_privateprefix npm_privateprefix eyJprivate.payload.signature\nnpm error ::warning:: useful final reason${controls ? "\x1b[31m\r\n::error::injected" : ""}`;
			fakeNpm(stderr, 1, "private stdout");
			process.env.APP_SECRET = secret;
			const before = readdirSync(tmpdir()).filter((name) => name.startsWith("formbar-rc-publish-"));
			let failure: unknown;
			try {
				await publishProtected("@formbar/expressions", Buffer.from("fixture"));
			} catch (error) {
				failure = error;
			}
			for (const surface of [String(failure), JSON.stringify(failure), (failure as Error).stack]) {
				expect(surface).not.toMatch(/private-|privateprefix|eyJprivate|host\.invalid|::/);
				expect(surface).not.toContain("\x1b");
			}
			expect(String(failure)).toContain("suppression=AUTH_MATERIAL_DETECTED");
			expect(String(failure)).not.toContain("useful final reason");
			expect(failure).not.toHaveProperty("cause");
			expect(readdirSync(tmpdir()).filter((name) => name.startsWith("formbar-rc-publish-"))).toEqual(before);
		},
	);

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

	it.each(authLeakFixtures)("withholds actual fake-exec auth capture (%#) and cleans up", async (stderr) => {
		const { calls } = fakeNpm(`npm error safe-before\n${stderr}\nnpm error safe-after`, 1);
		const before = readdirSync(tmpdir()).filter((name) => name.startsWith("formbar-rc-publish-"));
		const failure = await publishProtected("@formbar/expressions", Buffer.from("fixture")).catch((error) => error);
		assertAuthWithheld(failure);
		expect(readFileSync(calls, "utf8")).toBe("attempt\n");
		expect(readdirSync(tmpdir()).filter((name) => name.startsWith("formbar-rc-publish-"))).toEqual(before);
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
		["unknown", "npm error useful unknown failure https://user:secret@registry.invalid/", "NPM_UNKNOWN"],
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
		expect(message).not.toMatch(/secret|registry\.invalid|opaque|user:/i);
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
		expect(String(failure)).not.toMatch(/secret|E404|oidc/i);
		expect(JSON.stringify(failure)).not.toMatch(/secret|E404|oidc/i);
		expect((failure as Error).stack).not.toMatch(/secret|E404|oidc/i);
		expect(failure).not.toHaveProperty("cause");
		expect(spy).not.toHaveBeenCalled();
		expect(readFileSync(calls, "utf8")).toBe("attempt\n");
	});
});
