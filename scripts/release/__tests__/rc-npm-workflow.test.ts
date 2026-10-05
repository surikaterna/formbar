import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { kaladaProductionDependencies, rcEdges, rcPackages, readRcPlan } from "../rc-workspace-plan.mjs";

const source = readFileSync(resolve(".github/workflows/release.yml"), "utf8");
const workflow = YAML.parse(source);
const job = workflow.jobs["publish-rc"];
const packages = rcPackages;
const version = "0.23.0-rc.0";
const versions = Object.fromEntries(readRcPlan(process.cwd()).map(({ name, version }) => [name.slice(9), version]));
type Call = { args: string[]; cwd: string; metadata: string[] };

function fixtureMetadata(directory: string) {
	return [".changeset/pre.json", ...packages.map((name) => `packages/${name}/package.json`)].map((path) =>
		readFileSync(join(directory, path), "utf8"),
	);
}

function prepareFixture(directory: string, scenario: string, changedVersion: string, changedName?: string) {
	const bin = join(directory, "bin");
	mkdirSync(bin);
	mkdirSync(join(directory, "scripts/release"), { recursive: true });
	copyFileSync(
		resolve("scripts/release/rc-workspace-plan.mjs"),
		join(directory, "scripts/release/rc-workspace-plan.mjs"),
	);
	mkdirSync(join(directory, ".changeset"));
	writeFileSync(
		join(directory, ".changeset/pre.json"),
		JSON.stringify({
			mode: "pre",
			tag: "rc",
			changesets: [],
			initialVersions: Object.fromEntries(packages.map((name) => [`@formbar/${name}`, "0.0.0"])),
		}),
	);
	for (const name of packages) {
		const path = join(directory, "packages", name);
		mkdirSync(path, { recursive: true });
		writeFileSync(
			join(path, "package.json"),
			JSON.stringify({
				name: name === "react-schema" ? changedName || `@formbar/${name}` : `@formbar/${name}`,
				version: scenario === "all-invalid" || name === "react-schema" ? changedVersion : versions[name],
				dependencies: {
					...Object.fromEntries(rcEdges[name].map((edge) => [`@formbar/${edge}`, `^${versions[edge]}`])),
					...kaladaProductionDependencies[`@formbar/${name}`],
				},
			}),
		);
	}
	for (const command of ["npm", "bun"]) {
		const executable = join(bin, command);
		writeFileSync(
			executable,
			`#!/bin/sh\nexec node ${JSON.stringify(resolve("scripts/release/__tests__/manual-npm-fixture.cjs"))} "$@"\n`,
		);
		chmodSync(executable, 0o755);
	}
	const state = join(directory, "state.json");
	const log = join(directory, "calls.jsonl");
	writeFileSync(state, JSON.stringify({ scenario, version, versions, published: [], tagReads: [] }));
	writeFileSync(log, "");
	return { bin, state, log };
}

function runWorkflowShell(scenario: string, changedVersion = versions["react-schema"], changedName?: string) {
	const directory = mkdtempSync(join(tmpdir(), "formbar-manual-rc-"));
	try {
		const { bin, state, log } = prepareFixture(directory, scenario, changedVersion, changedName);
		const before = fixtureMetadata(directory);
		const preparation = ["prepare", "build-failure", "test-failure"].includes(scenario);
		const commands = job.steps
			.slice(preparation ? 4 : 7)
			.map((step: { run: string }) => step.run)
			.join("\n");
		const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", commands], {
			cwd: directory,
			encoding: "utf8",
			env: {
				...process.env,
				PATH: `${bin}:${process.env.PATH}`,
				TEST_STATE: state,
				TEST_LOG: log,
				GITHUB_EVENT_NAME: "workflow_dispatch",
				GITHUB_REPOSITORY_ID: "1245476636",
				GITHUB_REPOSITORY_OWNER_ID: "9478205",
			},
		});
		const calls = readFileSync(log, "utf8")
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line): Call => JSON.parse(line));
		return {
			...result,
			calls,
			metadataUnchanged: JSON.stringify(before) === JSON.stringify(fixtureMetadata(directory)),
			publications: calls.filter((call) => call.args[0] === "publish"),
		};
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

describe("#442 executable manual RC workflow (fake npm, no network or OIDC)", () => {
	it.each([
		["workflow_dispatch", "surikaterna/formbar", "refs/heads/main", "spralle", true],
		["push", "surikaterna/formbar", "refs/heads/main", "spralle", false],
		["workflow_dispatch", "other/repo", "refs/heads/main", "spralle", false],
		["workflow_dispatch", "surikaterna/formbar", "refs/heads/feature", "spralle", false],
		["workflow_dispatch", "surikaterna/formbar", "refs/heads/main", "other", false],
	])("job eligibility %s %s %s %s", (event, repository, ref, actor, expected) => {
		const context: Record<string, string> = {
			event_name: String(event),
			repository: String(repository),
			ref: String(ref),
			actor: String(actor),
		};
		const comparisons = job.if.split(" && ").map((condition: string) => {
			const match = condition.match(/^github\.(\w+) == '([^']+)'$/);
			if (!match) throw new Error(`Unexpected condition: ${condition}`);
			return context[match[1]] === match[2];
		});
		expect(comparisons.every(Boolean)).toBe(expected);
	});

	it("uses standard setup, permissions and sequential install/build/full tests before publishing", () => {
		expect(job.permissions).toEqual({ contents: "read", "id-token": "write" });
		expect(job.concurrency).toEqual({ group: "formbar-manual-rc", "cancel-in-progress": false });
		expect(job.environment).toBeUndefined();
		expect(job.steps[0]).toEqual({ name: "Checkout", uses: "actions/checkout@v5", with: { "fetch-depth": 0 } });
		expect(job.steps.slice(0, 3)).toMatchObject([
			{ uses: "actions/checkout@v5" },
			{ uses: "oven-sh/setup-bun@v2", with: { "bun-version": "1.2.21" } },
			{ uses: "actions/setup-node@v4", with: { "node-version": "22.23.2" } },
		]);
		expect(job.steps[3].run).toContain("npm@11.20.0");
		expect(job.steps[3].run).toContain("RC_NODE_BINARY=%s\\nRC_NPM_ROOT=%s");
		expect(job.steps.slice(4, 7).map((step: { run: string }) => step.run)).toEqual([
			"bun install --frozen-lockfile",
			"bun run build",
			"bun run test",
		]);
		expect(source).not.toMatch(
			/environment:|NPM_TOKEN|NODE_AUTH_TOKEN|\.npmrc|registry-url|preflight|runProtectedRc|expected_main_sha|GO_BYPASS/,
		);
		expect(job.steps.every((step: { env?: unknown }) => !step.env)).toBe(true);
	});

	it("publishes direct directories in dependency order, preserving public metadata and normal output", () => {
		const result = runWorkflowShell("absent");
		expect(result.status, result.stderr).toBe(0);
		expect(result.metadataUnchanged).toBe(true);
		expect(result.publications.map((call) => call.cwd)).toEqual(packages);
		for (const call of result.publications)
			expect(call.args).toEqual(["publish", "--tag", "rc", "--access", "public", "--provenance"]);
		for (const call of result.calls) expect(call.metadata).toEqual(["workflow_dispatch", "1245476636", "9478205"]);
		expect(result.calls.slice(0, 9).map((call) => call.args)).toEqual(
			packages.map((name) => ["view", `@formbar/${name}`, "dist-tags", "--json"]),
		);
		expect(result.calls.slice(9, 27).map((call) => call.args[0])).toEqual(packages.flatMap(() => ["view", "publish"]));
		expect(result.calls.slice(27).map((call) => call.args)).toEqual(
			packages.flatMap((name) => [
				["view", `@formbar/${name}@${versions[name]}`, "name", "version", "--json"],
				["view", `@formbar/${name}`, "dist-tags", "--json"],
			]),
		);
		expect(result.stdout).toContain("normal npm publish stdout");
		expect(result.stderr).toContain("normal npm publish stderr");
	});
	it("executes frozen install then build then full tests before any registry access", () => {
		const result = runWorkflowShell("prepare");
		expect(result.status, result.stderr).toBe(0);
		expect(result.calls.slice(0, 3).map((call) => call.args)).toEqual([
			["install", "--frozen-lockfile"],
			["run", "build"],
			["run", "test"],
		]);
		expect(result.calls[3].args[0]).toBe("view");
	});
	it.each(["build-failure", "test-failure"])("stops %s before registry access", (scenario) => {
		const result = runWorkflowShell(scenario);
		expect(result.status).toBe(19);
		expect(result.calls.every((call) => ["install", "run"].includes(call.args[0]))).toBe(true);
	});
	it.each(["latest-error", "latest-malformed", "unexpected-absence"])(
		"requires a valid latest snapshot: %s",
		(scenario) => {
			const result = runWorkflowShell(scenario);
			expect(result.status).not.toBe(0);
			expect(result.calls).toHaveLength(1);
			expect(result.publications).toEqual([]);
		},
	);

	it.each(["0.23.0", "0.23.0-rc", "0.23.0-rc.01", "00.23.0-rc.0", "0.23.0-rc.0+build"])(
		"denies version %s before registry access",
		(candidate) => {
			const result = runWorkflowShell("absent", candidate);
			expect(result.status).not.toBe(0);
			expect(result.calls).toEqual([]);
		},
	);
	it("denies a mismatched package name before registry access", () => {
		const result = runWorkflowShell("absent", versions["react-schema"], "@formbar/other");
		expect(result.status).not.toBe(0);
		expect(result.calls).toEqual([]);
	});
	it.each(["0.23.0", "0.23.0-rc", "0.23.0-rc.01", "00.23.0-rc.0", "0.23.0-rc.0+build"])(
		"denies nine equal but invalid versions %s",
		(candidate) => {
			const result = runWorkflowShell("all-invalid", candidate);
			expect(result.status).not.toBe(0);
			expect(result.calls).toEqual([]);
		},
	);
	it("skips matching immutable existing versions and still checks postflight", () => {
		const result = runWorkflowShell("existing");
		expect(result.status, result.stderr).toBe(0);
		expect(result.publications).toEqual([]);
		expect(result.stdout.match(/Skipping immutable existing/g)).toHaveLength(9);
		expect(result.calls).toHaveLength(36);
	});
	it.each([
		"E403",
		"E500",
		"unknown",
		"network",
		"malformed",
		"unstructured-404",
		"wrong-existing-name",
		"wrong-existing-version",
	])("stops on %s rather than assuming absence", (scenario) => {
		const result = runWorkflowShell(scenario);
		expect(result.status).not.toBe(0);
		expect(result.publications).toEqual([]);
		expect(result.calls).toHaveLength(10);
	});
	it("does not retry a failed PUT or attempt later packages", () => {
		const result = runWorkflowShell("publish-failure");
		expect(result.status).toBe(17);
		expect(result.publications.map((call) => call.cwd)).toEqual(["expressions", "core"]);
		expect(result.stderr).toContain("normal npm publish stderr");
	});
	it("does not mistake new-package authentication failure for registry absence", () => {
		const result = runWorkflowShell("fsx-auth");
		expect(result.status).not.toBe(0);
		expect(result.publications).toEqual([]);
		expect(result.calls).toHaveLength(4);
	});
	it("stops at failed FSX bootstrap without token fallback or publishing dependants", () => {
		const result = runWorkflowShell("fsx-bootstrap-failure");
		expect(result.status).toBe(17);
		expect(result.publications.map(({ cwd }) => cwd)).toEqual(packages.slice(0, 4));
	});
	it("admits absent latest only for the two enrolled FSX packages", () => {
		const result = runWorkflowShell("empty-fsx-tags");
		expect(result.status, result.stderr).toBe(0);
		expect(result.publications.map(({ cwd }) => cwd)).toEqual(packages);
	});
	it("rejects editor authentication failure before any publication", () => {
		const result = runWorkflowShell("editor-auth");
		expect(result.status).not.toBe(0);
		expect(result.calls).toHaveLength(5);
		expect(result.publications).toEqual([]);
	});
	it("stops at failed editor bootstrap without fallback or publishing later packages", () => {
		const result = runWorkflowShell("editor-bootstrap-failure");
		expect(result.status).toBe(17);
		expect(result.publications.map(({ cwd }) => cwd)).toEqual(packages.slice(0, 5));
	});
	it.each(["wrong-rc", "moved-latest", "wrong-post-name", "wrong-post-version"])(
		"fails postflight %s without repair",
		(scenario) => {
			const result = runWorkflowShell(scenario);
			expect(result.status).not.toBe(0);
			expect(result.publications).toHaveLength(9);
			expect(result.calls.every((call) => ["view", "publish"].includes(call.args[0]))).toBe(true);
		},
	);
});
