import { describe, expect, it, vi } from "vitest";
import { type RunWitness, fetchRcEvidence } from "../live-evidence";
import { type GitHubRead, repo } from "../live-evidence-shape";
import { endpointResponses } from "./rc-workflow-fixture";

const sha = "a".repeat(40);
const tree = "b".repeat(40);
const witness: RunWitness = {
	runId: 12345,
	attempt: 1,
	actor: "spralle",
	senderId: 806157,
	repository: "surikaterna/formbar",
	event: "workflow_dispatch",
	ref: "refs/heads/main",
	workflowRef: "surikaterna/formbar/.github/workflows/release.yml@refs/heads/main",
	workflowSha: sha,
	eventSha: sha,
	checkoutSha: sha,
	checkoutTree: tree,
	expectedSha: sha,
};

function fixture() {
	const values = endpointResponses(sha, tree, new Date());
	const get = vi.fn(async (path: string) => {
		if (!(path in values)) throw Object.assign(new Error("Not Found"), { status: 404 });
		return values[path];
	});
	return { values, api: { get } satisfies GitHubRead, get };
}

describe("#406 single-operator read-only exact-run authority", () => {
	it("accepts spralle with no GO or approval endpoint and only GET capability", async () => {
		const { api, get } = fixture();
		await expect(fetchRcEvidence(api, witness)).resolves.toBeUndefined();
		expect(get.mock.calls.every(([path]) => !path.includes("/issues/250/") && !path.endsWith("/approvals"))).toBe(true);
		expect(Object.keys(api)).toEqual(["get"]);
	});
	it.each([
		{ actor: "eaglez" },
		{ actor: "unknown" },
		{ senderId: 1532734 },
		{ runId: 12346 },
		{ attempt: 2 },
		{ eventSha: tree },
		{ workflowSha: tree },
		{ checkoutSha: tree },
		{ checkoutTree: sha },
		{ ref: "refs/heads/other" },
		{ workflowRef: "surikaterna/formbar/.github/workflows/ci.yml@refs/heads/main" },
	])("rejects witness drift %o", async (drift) => {
		await expect(fetchRcEvidence(fixture().api, { ...witness, ...drift })).rejects.toThrow();
	});
	it.each([
		[`${repo}/actions/runs/12345`, "run_attempt", 2],
		[`${repo}/actions/runs/12345`, "actor", { id: 1532734 }],
		[`${repo}/actions/runs/12345`, "triggering_actor", { id: 1532734 }],
		[`${repo}/actions/runs/12345`, "head_branch", "other"],
		[`${repo}/branches/main`, "commit", { sha: tree }],
		[`${repo}/git/commits/${sha}`, "tree", { sha }],
		[`${repo}/rulesets/24103769`, "bypass_actors", [{ actor_id: 1 }]],
		[`${repo}/rulesets/24103769`, "enforcement", "disabled"],
		[`${repo}/environments/formbar-rc`, "can_admins_bypass", true],
		[
			`${repo}/environments/formbar-rc`,
			"protection_rules",
			[{ type: "required_reviewers" }, { type: "branch_policy" }],
		],
		[`${repo}/environments/formbar-rc/deployment-branch-policies`, "total_count", 0],
		[`${repo}/commits/${sha}/check-runs?per_page=100&page=1`, "total_count", 0],
	] as const)("rejects live drift %s %s", async (path, key, value) => {
		const { api, values } = fixture();
		(values[path] as Record<string, unknown>)[key] = value;
		await expect(fetchRcEvidence(api, witness)).rejects.toThrow();
	});
	it("rejects ungreen, missing and ambiguous same-SHA CI", async () => {
		const path = `${repo}/commits/${sha}/check-runs?per_page=100&page=1`;
		for (const checks of [
			[],
			[{ name: "ci", head_sha: sha, status: "completed", conclusion: "failure", app: { id: 15368 } }],
		]) {
			const { api, values } = fixture();
			values[path] = { total_count: checks.length, check_runs: checks };
			await expect(fetchRcEvidence(api, witness)).rejects.toThrow();
		}
		const { api, values } = fixture();
		const check = (values[path] as { check_runs: unknown[] }).check_runs[0];
		values[path] = { total_count: 2, check_runs: [check, check] };
		await expect(fetchRcEvidence(api, witness)).rejects.toThrow();
	});
	it.each([401, 403, 404, 500])("denies HTTP %i", async (status) => {
		const { api } = fixture();
		api.get = vi.fn(async () => {
			throw Object.assign(new Error("HTTP"), { status });
		});
		await expect(fetchRcEvidence(api, witness)).rejects.toThrow();
	});
});
