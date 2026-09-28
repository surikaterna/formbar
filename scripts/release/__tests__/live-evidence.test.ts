import { describe, expect, it, vi } from "vitest";
import { type RunWitness, fetchRcEvidence } from "../live-evidence";
import { type GitHubRead, rcNames, repo } from "../live-evidence-shape";

const commit = "a".repeat(40);
const tree = "b".repeat(40);
const runId = 12345;
const now = new Date("2026-09-28T11:00:00Z");
const witness: RunWitness = {
	runId,
	attempt: 1,
	actor: "eaglez",
	senderId: 1532734,
	repository: "surikaterna/formbar",
	event: "workflow_dispatch",
	ref: "refs/heads/main",
	workflowRef: "surikaterna/formbar/.github/workflows/release.yml@refs/heads/main",
	workflowSha: commit,
	eventSha: commit,
	checkoutSha: commit,
	checkoutTree: tree,
	expectedSha: commit,
};
const deps: Record<string, string[]> = {
	arbiter: ["core", "expressions"],
	core: ["expressions"],
	declarative: ["core", "expressions"],
	"from-schema": ["core", "declarative", "expressions"],
	react: ["core", "expressions"],
	"react-schema": ["core", "declarative", "from-schema", "react"],
};
const versions = Object.fromEntries(
	rcNames.map((name) => [
		`@formbar/${name}`,
		{
			version: "0.23.0-rc.0",
			dependencies: Object.fromEntries(
				deps[name].map((dep) => [`@formbar/${dep}`, dep === "expressions" ? "^0.14.3" : "^0.23.0-rc.0"]),
			),
		},
	]),
);
const body = `FINAL GO\n${JSON.stringify({
	run_id: runId,
	attempt: 1,
	sha: commit,
	tree,
	versions,
	acknowledges_legacy_validation_issue:
		"I acknowledge the global/default legacy ValidationIssue identity, mutability and non-JSON shape migration.",
})}`;
const ci = { name: "ci", head_sha: commit, status: "completed", conclusion: "success", app: { id: 15368 } };
const ruleTypes = ["deletion", "non_fast_forward", "pull_request", "required_status_checks"];
const pr = {
	required_approving_review_count: 0,
	required_reviewers: [],
	allowed_merge_methods: ["merge", "squash", "rebase"],
};
const checks = { required_status_checks: [{ context: "ci", integration_id: 15368 }] };

function fixture() {
	const go = {
		id: 456,
		issue_url: `https://api.github.com/${repo}/issues/250`,
		user: { id: 806157 },
		created_at: "2026-09-28T10:01:00Z",
		updated_at: "2026-09-28T10:01:00Z",
		body,
	};
	const values: Record<string, unknown> = {
		[`${repo}/actions/runs/${runId}`]: {
			id: runId,
			event: "workflow_dispatch",
			run_attempt: 1,
			actor: { id: 1532734 },
			triggering_actor: { id: 1532734 },
			head_sha: commit,
			head_branch: "main",
			path: ".github/workflows/release.yml",
			workflow_id: 349257014,
			created_at: "2026-09-28T10:00:00Z",
			head_commit: { tree_id: tree },
		},
		[`${repo}/branches/main`]: { commit: { sha: commit } },
		[`${repo}/git/commits/${commit}`]: { tree: { sha: tree } },
		[`${repo}/collaborators/eaglez/permission`]: { user: { id: 1532734 }, permission: "admin" },
		[`${repo}/collaborators/spralle/permission`]: { user: { id: 806157 }, permission: "admin" },
		[`${repo}/rulesets/24103769`]: {
			id: 24103769,
			target: "branch",
			source_type: "Repository",
			enforcement: "active",
			conditions: { ref_name: { include: ["refs/heads/main"], exclude: [] } },
			bypass_actors: [],
			current_user_can_bypass: "never",
			rules: ruleTypes.map((type) => ({
				type,
				parameters: type === "pull_request" ? pr : type === "required_status_checks" ? checks : undefined,
			})),
		},
		[`${repo}/rules/branches/main`]: ruleTypes.map((type) => ({
			ruleset_id: 24103769,
			type,
			parameters: type === "pull_request" ? pr : type === "required_status_checks" ? checks : null,
		})),
		[`${repo}/environments/formbar-rc`]: {
			id: 22904271021,
			can_admins_bypass: false,
			deployment_branch_policy: { custom_branch_policies: true, protected_branches: false },
			protection_rules: [
				{
					type: "required_reviewers",
					prevent_self_review: true,
					reviewers: [{ type: "User", reviewer: { id: 806157 } }],
				},
				{ type: "branch_policy" },
			],
		},
		[`${repo}/environments/formbar-rc/deployment-branch-policies`]: {
			total_count: 1,
			branch_policies: [{ id: 61266216, name: "main", type: "branch" }],
		},
		[`${repo}/commits/${commit}/check-runs?per_page=100&page=1`]: { total_count: 1, check_runs: [ci] },
		[`${repo}/issues/250/comments?per_page=100&page=1`]: [go],
		[`${repo}/issues/comments/456`]: go,
		[`${repo}/actions/runs/${runId}/approvals`]: [
			{ state: "approved", user: { id: 806157 }, environments: [{ id: 22904271021, name: "formbar-rc" }] },
		],
	};
	const get = vi.fn(async (path: string) => {
		if (!(path in values)) throw Object.assign(new Error("Not Found"), { status: 404 });
		return values[path];
	});
	return { values, api: { get } satisfies GitHubRead, get };
}

describe("#365 read-only exact-run REST evidence", () => {
	it("accepts only a complete fresh endpoint-shaped snapshot, without any write interface", async () => {
		const { api, get } = fixture();
		await expect(fetchRcEvidence(api, witness, now)).resolves.toEqual({ commentId: 456 });
		expect(get).toHaveBeenCalledWith(`${repo}/actions/runs/${runId}/approvals`);
		expect(Object.keys(api)).toEqual(["get"]);
	});
	it.each([
		[`${repo}/actions/runs/${runId}`, "run_attempt", 2],
		[`${repo}/actions/runs/${runId}`, "head_branch", "other"],
		[`${repo}/actions/runs/${runId}`, "triggering_actor", { id: 806157 }],
		[`${repo}/branches/main`, "commit", { sha: tree }],
		[`${repo}/git/commits/${commit}`, "tree", { sha: commit }],
		[`${repo}/rulesets/24103769`, "bypass_actors", [{ actor_id: 1 }]],
		[`${repo}/rulesets/24103769`, "enforcement", "disabled"],
		[`${repo}/environments/formbar-rc`, "can_admins_bypass", true],
		[`${repo}/actions/runs/${runId}/approvals`, "length", 0],
	] as const)("denies drift at %s %s", async (path, key, value) => {
		const { values, api } = fixture();
		if (key === "length") values[path] = [];
		else (values[path] as Record<string, unknown>)[key] = value;
		await expect(fetchRcEvidence(api, witness, now)).rejects.toThrow();
	});
	it.each([404, 401, 403, 500])("denies HTTP %i rather than treating it as empty", async (status) => {
		const { api } = fixture();
		api.get = vi.fn(async () => {
			throw Object.assign(new Error("HTTP"), { status });
		});
		await expect(fetchRcEvidence(api, witness, now)).rejects.toThrow();
	});
	it.each([
		{ actor: "spralle" },
		{ senderId: 806157 },
		{ runId: 12346 },
		{ attempt: 2 },
		{ eventSha: tree },
		{ workflowSha: tree },
		{ checkoutSha: tree },
		{ checkoutTree: commit },
		{ workflowRef: "surikaterna/formbar/.github/workflows/ci.yml@refs/heads/main" },
	])("denies runtime mismatch %o", async (change) => {
		const { api } = fixture();
		await expect(fetchRcEvidence(api, { ...witness, ...change }, now)).rejects.toThrow();
	});
	it.each([
		{ updated_at: "2026-09-28T10:01:01Z" },
		{ created_at: "2026-09-28T10:00:00Z", updated_at: "2026-09-28T10:00:00Z" },
		{ user: { id: 1532734 } },
		{ issue_url: `https://api.github.com/${repo}/issues/363` },
		{ body: body.replace('"run_id":12345', '"run_id":99999') },
		{ body: body.replace("non-JSON shape migration", "migration") },
	])("denies wrong/edited GO %o", async (change) => {
		const { values, api } = fixture();
		values[`${repo}/issues/comments/456`] = { ...(values[`${repo}/issues/comments/456`] as object), ...change };
		await expect(fetchRcEvidence(api, witness, now)).rejects.toThrow();
	});
	it("denies missing, ambiguous, malformed and expired GO", async () => {
		for (const comments of [
			[],
			[fixture().values[`${repo}/issues/comments/456`], fixture().values[`${repo}/issues/comments/456`]],
			null,
		]) {
			const { values, api } = fixture();
			values[`${repo}/issues/250/comments?per_page=100&page=1`] = comments;
			await expect(fetchRcEvidence(api, witness, now)).rejects.toThrow();
		}
		const { api } = fixture();
		await expect(fetchRcEvidence(api, witness, new Date("2026-09-29T11:00:00Z"))).rejects.toThrow();
	});
	it("reads every comment page and denies truncated or ambiguous pagination", async () => {
		const { values, api } = fixture();
		const match = values[`${repo}/issues/comments/456`];
		values[`${repo}/issues/250/comments?per_page=100&page=1`] = Array.from({ length: 100 }, (_, i) => ({
			id: i + 1,
			body: "not a GO",
		}));
		values[`${repo}/issues/250/comments?per_page=100&page=2`] = [match];
		await expect(fetchRcEvidence(api, witness, now)).resolves.toEqual({ commentId: 456 });
		delete values[`${repo}/issues/250/comments?per_page=100&page=2`];
		await expect(fetchRcEvidence(api, witness, now)).rejects.toThrow();
	});
	it("denies duplicate JSON keys, wrong package ranges and ambiguous GO body", async () => {
		for (const changed of [
			body.replace('"attempt":1', '"attempt":1,"attempt":1'),
			body.replace("^0.14.3", "^0.14.2"),
			"FINAL GO\nnot-json",
		]) {
			const { values, api } = fixture();
			values[`${repo}/issues/250/comments?per_page=100&page=1`] = [
				{ ...(values[`${repo}/issues/comments/456`] as object), body: changed },
			];
			values[`${repo}/issues/comments/456`] = { ...(values[`${repo}/issues/comments/456`] as object), body: changed };
			await expect(fetchRcEvidence(api, witness, now)).rejects.toThrow();
		}
	});
	it("denies missing environment binding, incorrect reviewer and CI ambiguity", async () => {
		for (const approval of [
			{ state: "approved", user: { id: 806157 } },
			{ state: "approved", user: { id: 1532734 }, environments: [{ id: 22904271021, name: "formbar-rc" }] },
		]) {
			const { values, api } = fixture();
			values[`${repo}/actions/runs/${runId}/approvals`] = [approval];
			await expect(fetchRcEvidence(api, witness, now)).rejects.toThrow();
		}
		const { values, api } = fixture();
		values[`${repo}/commits/${commit}/check-runs?per_page=100&page=1`] = { total_count: 2, check_runs: [ci, ci] };
		await expect(fetchRcEvidence(api, witness, now)).rejects.toThrow();
	});
});
