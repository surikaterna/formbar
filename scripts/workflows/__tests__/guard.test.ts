import { describe, expect, it } from "vitest";
import { expectedSha, guardStep, loadWorkflow, runGuard, workflowCases } from "./fixtures";

async function scriptFor(file: string, job: string): Promise<string> {
	const script = guardStep(await loadWorkflow(file), job).run;
	if (!script) throw new Error(`Missing recovery script in ${file}`);
	return script;
}

describe("executable exact-SHA recovery guard", () => {
	it.each(workflowCases)("accepts the authorized current main SHA for $file", async ({ file, job }) => {
		await expect(runGuard(file, await scriptFor(file, job))).resolves.toMatchObject({ stdout: "" });
	});

	const environmentFailures = [
		["another repository", { GITHUB_REPOSITORY: "surikaterna/fork" }],
		["a non-main ref", { GITHUB_REF: "refs/heads/topic" }],
		["an unprotected event ref", { GITHUB_REF_PROTECTED: "false" }],
		["an absent expected SHA", { EXPECTED_MAIN_SHA: "" }],
		["a short expected SHA", { EXPECTED_MAIN_SHA: expectedSha.slice(0, 12) }],
		["an uppercase expected SHA", { EXPECTED_MAIN_SHA: expectedSha.toUpperCase() }],
		["an absent issue number", { RECOVERY_ISSUE: "" }],
		["a zero issue number", { RECOVERY_ISSUE: "0" }],
		["a formatted issue number", { RECOVERY_ISSUE: "#103" }],
		["a workflow loaded from a tag", { GITHUB_WORKFLOW_REF: "surikaterna/formbar/.github/workflows/ci.yml@v1" }],
		[
			"the wrong workflow path",
			{ GITHUB_WORKFLOW_REF: "surikaterna/formbar/.github/workflows/pages.yml@refs/heads/main" },
		],
		["a different workflow SHA", { GITHUB_WORKFLOW_SHA: "1111111111111111111111111111111111111111" }],
		["a different event SHA", { GITHUB_SHA: "1111111111111111111111111111111111111111" }],
	] as const;

	it.each(environmentFailures)("rejects %s", async (_name, env) => {
		await expect(runGuard("ci.yml", await scriptFor("ci.yml", "ci"), { env })).rejects.toThrow();
	});

	const apiFailures = [
		["a non-main default branch", { defaultBranch: "trunk" }],
		["an unprotected live main branch", { mainProtected: "false" }],
		["an advanced live main branch", { mainSha: "1111111111111111111111111111111111111111" }],
		["a closed recovery issue", { issueState: "closed" }],
		["a pull request number", { issueIsPr: "true" }],
		["an unavailable repository API", { failEndpoint: "repos/surikaterna/formbar" }],
		["an unavailable branch API", { failEndpoint: "repos/surikaterna/formbar/branches/main" }],
		["an unavailable ref API", { failEndpoint: "repos/surikaterna/formbar/git/ref/heads/main" }],
		["an unavailable issue API", { failEndpoint: "repos/surikaterna/formbar/issues/103" }],
	] as const;

	it.each(apiFailures)("rejects %s", async (_name, api) => {
		await expect(runGuard("ci.yml", await scriptFor("ci.yml", "ci"), { api })).rejects.toThrow();
	});
});
