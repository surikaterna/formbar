import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ audit: vi.fn(), refresh: vi.fn(), source: vi.fn(), cli: vi.fn() }));
vi.mock("../../package-artifacts/audit", () => ({ auditPackages: mocks.audit }));
vi.mock("../rc-run-authority", () => ({ refreshVerifiedRun: mocks.refresh }));
vi.mock("../rc-pack-evidence", () => ({ loadRcSource: mocks.source }));
vi.mock("node:child_process", () => ({ execFileSync: mocks.cli }));

import { prepackProtectedRun, verifiedCandidateBytes } from "../rc-prepacked-candidates";
import { rcPackages } from "../rc-reviewed-plan";
import type { VerifiedRun } from "../rc-run-authority";

const run = Object.freeze({}) as VerifiedRun; // Mock-only: production refresh rejects this value.
const bytes = rcPackages.map((name) => Buffer.from(`native tarball for ${name}`));
let configDir: string;

function setup() {
	vi.resetAllMocks();
	configDir = mkdtempSync(join(tmpdir(), "formbar-rc-mock-config-"));
	for (const name of ["user", "global"]) writeFileSync(join(configDir, `${name}.npmrc`), "", { mode: 0o600 });
	vi.stubEnv("npm_config_userconfig", join(configDir, "user.npmrc"));
	vi.stubEnv("npm_config_globalconfig", join(configDir, "global.npmrc"));
	vi.stubEnv("npm_config_offline", "true");
	for (const key of ["NPM_TOKEN", "NODE_AUTH_TOKEN", "npm_config_auth", "npm_config__authToken"])
		vi.stubEnv(key, undefined);
	mocks.refresh.mockResolvedValue({ root: "/checkout", sha: "a".repeat(40), tree: "b".repeat(40), runId: 12345 });
	mocks.cli.mockImplementation((name: string) => (name === "node" ? "v22.23.2\n" : "11.20.0\n"));
	mocks.audit.mockImplementation(() =>
		rcPackages.map((name, index) => ({ name: `@formbar/${name}`, bytes: Buffer.from(bytes[index]) })),
	);
}

afterEach(() => {
	vi.unstubAllEnvs();
	if (configDir) rmSync(configDir, { recursive: true, force: true });
});

describe("#389 disabled native seven-candidate byte witness (pack process mocked, no publish)", () => {
	it("copies two native pack passes and binds each digest and bytes to the same run", async () => {
		setup();
		const candidates = await prepackProtectedRun(run);
		expect(candidates.map(({ name }) => name)).toEqual(rcPackages.map((name) => `@formbar/${name}`));
		expect(mocks.audit).toHaveBeenCalledTimes(2);
		expect(mocks.source).toHaveBeenCalledWith("/checkout", "a".repeat(40), "b".repeat(40));
		for (const [index, candidate] of candidates.entries()) {
			expect(candidate.sha512).toBe(createHash("sha512").update(bytes[index]).digest("hex"));
			expect(candidate.integrity).toBe(`sha512-${createHash("sha512").update(bytes[index]).digest("base64")}`);
			expect(candidate.shasum).toBe(createHash("sha1").update(bytes[index]).digest("hex"));
			const copy = await verifiedCandidateBytes(run, candidate);
			copy[0] ^= 255;
			expect(await verifiedCandidateBytes(run, candidate)).toEqual(bytes[index]);
		}
		await expect(verifiedCandidateBytes(Object.freeze({}) as VerifiedRun, candidates[0])).rejects.toThrow("run-bound");
		await expect(verifiedCandidateBytes(run, { ...candidates[0] })).rejects.toThrow("run-bound");
	});
	it.each([
		"wrong-node",
		"wrong-npm",
		"ambient-token",
		"wrong-config",
		"same-config",
		"nonempty-config",
		"nondeterministic",
		"missing",
		"reordered",
		"changed-run",
	])("rejects %s without creating a candidate", async (failure) => {
		setup();
		if (failure === "wrong-node" || failure === "wrong-npm")
			mocks.cli.mockImplementation((name: string) =>
				name === "node"
					? failure === "wrong-node"
						? "v21.0.0"
						: "v22.23.2"
					: failure === "wrong-npm"
						? "10.9.8"
						: "11.20.0",
			);
		if (failure === "ambient-token") vi.stubEnv("NPM_TOKEN", "unsafe");
		if (failure === "wrong-config") vi.stubEnv("npm_config_userconfig", "/home/user/.npmrc");
		if (failure === "same-config") vi.stubEnv("npm_config_globalconfig", join(configDir, "user.npmrc"));
		if (failure === "nonempty-config")
			writeFileSync(join(configDir, "user.npmrc"), "//registry.npmjs.org/:_authToken=bad");
		if (failure === "nondeterministic" || failure === "missing" || failure === "reordered") {
			mocks.audit.mockImplementationOnce(() =>
				rcPackages.map((name, index) => ({ name: `@formbar/${name}`, bytes: Buffer.from(bytes[index]) })),
			);
			mocks.audit.mockImplementationOnce(() => {
				const second = rcPackages.map((name, index) => ({
					name: `@formbar/${name}`,
					bytes: Buffer.from(bytes[index]),
				}));
				if (failure === "missing") second.pop();
				if (failure === "reordered") second.reverse();
				if (failure === "nondeterministic") second[0].bytes[0] ^= 255;
				return second;
			});
		}
		if (failure === "changed-run")
			mocks.refresh
				.mockResolvedValueOnce({ root: "/checkout", sha: "a".repeat(40), tree: "b".repeat(40), runId: 1 })
				.mockRejectedValueOnce(new Error("new run"));
		await expect(prepackProtectedRun(run)).rejects.toThrow();
	});
});
