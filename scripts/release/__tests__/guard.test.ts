import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import YAML from "yaml";
import { checkRcCandidate, requireReleaseAuthority } from "../guard";
import type { DispatchContext } from "../guard";
import type { ReleasePlan, ReleaseReader } from "../types";

const sha = "a".repeat(40);
const context: DispatchContext = {
	event: "workflow_dispatch",
	repository: "surikaterna/formbar",
	ref: "refs/heads/main",
	workflowRef: "surikaterna/formbar/.github/workflows/release.yml@refs/heads/main",
	workflowSha: sha,
	eventSha: sha,
	checkoutSha: sha,
	liveMainSha: sha,
	expectedSha: sha,
};
const plan: ReleasePlan = {
	schemaVersion: 1,
	repository: context.repository,
	releaseCommit: sha,
	candidates: ["core", "arbiter", "declarative", "from-schema", "react", "react-schema"].map((name) => ({
		name: `@formbar/${name}`,
		version: "0.23.0-rc.0",
		directory: name,
		tag: `@formbar/${name}@0.23.0-rc.0`,
		notes: "release",
		prerelease: true,
		releaseCommit: sha,
		tagAction: "create",
		releaseAction: "create",
	})),
};
const npmVersion = vi.fn(async () => ({ exists: false }));
const reader = { npmVersion } as unknown as ReleaseReader;

describe("#350 fail-closed release", () => {
	it("keeps push-main proposal-only even when Changesets reports no changesets", async () => {
		const workflow = YAML.parse(await readFile(resolve(".github/workflows/release.yml"), "utf8"));
		expect(Object.keys(workflow.jobs)).toEqual(["version-proposal", "reject-dispatch"]);
		expect(workflow.on.push).toEqual({ branches: ["main"] });
		expect(Object.keys(workflow.on.workflow_dispatch.inputs)).toEqual(["expected_main_sha"]);
		expect(workflow.jobs["version-proposal"].if).toContain("github.event_name == 'push'");
		expect(workflow.jobs["version-proposal"].steps.at(-1)).toMatchObject({
			uses: "changesets/action@v1",
			with: { version: "bun run version:packages" },
		});
		expect(workflow.jobs["reject-dispatch"].if).toContain("workflow_dispatch");
		expect(workflow.jobs["reject-dispatch"].steps.at(-1).run).toContain("exit 1");
		expect(JSON.stringify(workflow.jobs)).not.toMatch(
			/hasChangesets|changeset publish|release\/plan|release\/apply|id-token|NPM_CONFIG_PROVENANCE/,
		);
	});

	it("dispatch runs only a rejecting shell step without any publish permission", async () => {
		const workflow = YAML.parse(await readFile(resolve(".github/workflows/release.yml"), "utf8"));
		const rejected = workflow.jobs["reject-dispatch"];
		expect(workflow.permissions).toEqual({ contents: "read" });
		expect(rejected.permissions).toEqual({ contents: "read" });
		expect(rejected.environment).toBeUndefined();
		const result = spawnSync("bash", ["-e", "-c", rejected.steps[0].run], {
			encoding: "utf8",
			env: { ...process.env, EXPECTED_MAIN_SHA: sha },
		});
		expect(result.status).toBe(1);
		expect(result.stdout).toContain("release dispatch disabled");
	});

	it.each([
		[{ event: "push" }, "dispatch"],
		[{ repository: "other/repo" }, "dispatch"],
		[{ ref: "refs/heads/feature" }, "main"],
		[{ workflowRef: "surikaterna/formbar/.github/workflows/release.yml@refs/heads/feature" }, "main"],
		[{ eventSha: "b".repeat(40) }, "SHA"],
		[{ workflowSha: "b".repeat(40) }, "SHA"],
		[{ checkoutSha: "b".repeat(40) }, "SHA"],
		[{ liveMainSha: "b".repeat(40) }, "SHA"],
		[{ expectedSha: "short" }, "SHA"],
	] as const)("rejects mismatched dispatch %o", async (change, message) => {
		await expect(checkRcCandidate({ ...context, ...change }, plan, reader)).rejects.toThrow(message);
	});

	it("rejects stable, wrong package sets and registry conflicts without writes", async () => {
		const stable = { ...plan, candidates: plan.candidates.map((c) => ({ ...c, version: "0.23.0" })) };
		await expect(checkRcCandidate(context, stable, reader)).rejects.toThrow("rc.0");
		await expect(checkRcCandidate(context, { ...plan, candidates: plan.candidates.slice(1) }, reader)).rejects.toThrow(
			"six-package",
		);
		const conflict: ReleaseReader = { ...reader, npmVersion: async () => ({ exists: true, gitHead: "b".repeat(40) }) };
		await expect(checkRcCandidate(context, plan, conflict)).rejects.toThrow("conflicting");
	});

	it("recognizes same-SHA registry retry but never treats it as approval", async () => {
		const same: ReleaseReader = { ...reader, npmVersion: async () => ({ exists: true, gitHead: sha }) };
		await checkRcCandidate(context, plan, same);
		expect(requireReleaseAuthority).toThrow("publishing disabled");
	});
});
