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

function fakeNpm(stderr: string, exit: number): { root: string; calls: string } {
	const root = mkdtempSync(join(tmpdir(), "rc-fake-npm-"));
	fixtures.push(root);
	mkdirSync(join(root, "bin"));
	const calls = join(root, "calls");
	writeFileSync(
		join(root, "bin/npm-cli.js"),
		`require('node:fs').appendFileSync(${JSON.stringify(calls)}, 'attempt\\n'); process.stderr.write(${JSON.stringify(stderr)}); process.exit(${exit});`,
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
		expect(npmCategory({ code: "ENOENT", stderr: "E_STAGE_REQUIRED secret" })).toBe("NPM_UNKNOWN");
	});
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
		["E_STAGE_REQUIRED", "npm ERR! code E_STAGE_REQUIRED", "NPM_STAGE_REQUIRED"],
		["403", "npm ERR! 403 Forbidden https://user:secret@registry.invalid/", "NPM_FORBIDDEN"],
		["OTP", "npm ERR! EOTP secret-otp", "NPM_OTP"],
		["permission", "npm ERR! EACCES secret-path", "NPM_PERMISSION"],
		["unknown", "secret-opaque https://user:secret@registry.invalid/", "NPM_UNKNOWN"],
	])("sanitizes fake npm %s without exposing subprocess output", async (_, stderr, category) => {
		const { calls } = fakeNpm(stderr, 1);
		const before = readdirSync(tmpdir()).filter((name) => name.startsWith("formbar-rc-publish-"));
		let message = "";
		try {
			await publishProtected("@formbar/expressions", Buffer.from("fixture"));
		} catch (error) {
			message = String(error);
		}
		expect(message).toMatch(
			new RegExp(`npm publish ${category} @formbar/expressions@0\\.23\\.0-rc\\.0 preflightMs=\\d+ npmMs=\\d+`),
		);
		expect(message).not.toMatch(/secret|registry\.invalid|opaque|npm ERR|user:/i);
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
});
