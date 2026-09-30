import { describe, expect, it, vi } from "vitest";
import { type RunWitness, fetchRcEvidence } from "../live-evidence";
import { type GitHubRead, repo } from "../live-evidence-shape";
import { verifyLivePolicy } from "../live-policy";
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
	refProtected: "true",
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
		{ refProtected: "false" },
		{ refProtected: "" },
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

describe("#411 main ruleset visibility boundary", () => {
	const rulesetPath = `${repo}/rulesets/24103769`;
	const cases: { name: string; change: (rule: Record<string, unknown>) => void; reason: string }[] = [
		{
			name: "wrong identity",
			change: (rule) => {
				rule.id = 0;
			},
			reason: "identity not verified",
		},
		{
			name: "disabled",
			change: (rule) => {
				rule.enforcement = "disabled";
			},
			reason: "enforcement not active",
		},
		{
			name: "wrong target",
			change: (rule) => {
				rule.target = "push";
			},
			reason: "target not branch",
		},
		{
			name: "wrong source",
			change: (rule) => {
				rule.source_type = "Organization";
			},
			reason: "source not repository",
		},
		{
			name: "missing ref scope",
			change: (rule) => {
				rule.conditions = null;
			},
			reason: "ref scope unreadable",
		},
		{
			name: "other branch",
			change: (rule) => {
				rule.conditions = { ref_name: { include: ["refs/heads/other"], exclude: [] } };
			},
			reason: "ref scope not verified",
		},
		{
			name: "present undefined is malformed",
			change: (rule) => {
				rule.bypass_actors = undefined;
			},
			reason: "bypass actors malformed",
		},
		...(["unknown", {}, 0, true] as unknown[]).map((value) => ({
			name: `malformed bypass ${String(value)}`,
			change: (rule: Record<string, unknown>) => {
				rule.bypass_actors = value;
			},
			reason: "bypass actors malformed",
		})),
		{
			name: "bypass granted",
			change: (rule) => {
				rule.bypass_actors = [{ actor_id: 1 }];
			},
			reason: "bypass actors changed",
		},
		{
			name: "caller redacted",
			change: (rule) => {
				rule.current_user_can_bypass = null;
			},
			reason: "caller bypass not verified",
		},
		{
			name: "caller omitted",
			change: (rule) => {
				rule.current_user_can_bypass = undefined;
			},
			reason: "caller bypass not verified",
		},
		{
			name: "caller allowed",
			change: (rule) => {
				rule.current_user_can_bypass = "always";
			},
			reason: "caller bypass not verified",
		},
		{
			name: "public shape with partial rules",
			change: (rule) => {
				rule.bypass_actors = null;
				rule.current_user_can_bypass = null;
				rule.rules = (rule.rules as { type: string }[]).filter((entry) =>
					["pull_request", "required_status_checks"].includes(entry.type),
				);
			},
			reason: "caller bypass not verified",
		},
		{
			name: "partial rules even with visible bypass",
			change: (rule) => {
				rule.rules = (rule.rules as { type: string }[]).filter((entry) => entry.type !== "deletion");
			},
			reason: "main ruleset types changed",
		},
	];

	it("accepts complete privileged REST evidence and effective main rules", async () => {
		await expect(verifyLivePolicy(fixture().api)).resolves.toBeUndefined();
	});
	it.each(["null", "missing"])("accepts %s only as UNVERIFIABLE with all other evidence intact", async (kind) => {
		const { api, values } = fixture();
		const rule = values[rulesetPath] as Record<string, unknown>;
		if (kind === "null") rule.bypass_actors = null;
		else values[rulesetPath] = Object.fromEntries(Object.entries(rule).filter(([key]) => key !== "bypass_actors"));
		const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			await expect(fetchRcEvidence(api, witness)).resolves.toBeUndefined();
			expect(warning).toHaveBeenCalledWith(expect.stringContaining("UNVERIFIABLE"));
			expect(warning).not.toHaveBeenCalledWith(expect.stringContaining("verified empty"));
		} finally {
			warning.mockRestore();
		}
	});
	it.each([
		["main", `${repo}/branches/main`, "commit", { sha: tree }],
		["CI", `${repo}/commits/${sha}/check-runs?per_page=100&page=1`, "total_count", 0],
		["policy", rulesetPath, "enforcement", "disabled"],
		["ref scope", rulesetPath, "conditions", { ref_name: { include: ["refs/heads/other"], exclude: [] } }],
	] as const)("redaction cannot override %s drift", async (_name, path, key, value) => {
		const { api, values } = fixture();
		(values[rulesetPath] as Record<string, unknown>).bypass_actors = null;
		(values[path] as Record<string, unknown>)[key] = value;
		const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			await expect(fetchRcEvidence(api, witness)).rejects.toThrow();
		} finally {
			warning.mockRestore();
		}
	});

	it.each(cases)("denies $name without exposing response bodies", async ({ change, reason }) => {
		const { api, values, get } = fixture();
		const rule = values[rulesetPath] as Record<string, unknown>;
		change(rule);
		rule.secret_fixture_marker = "DO_NOT_LOG_TOKEN_OR_BODY";
		const error = await verifyLivePolicy(api).then(
			() => "accepted",
			(failure: Error) => failure.message,
		);
		expect(error).toContain(reason);
		expect(error).not.toContain("DO_NOT_LOG_TOKEN_OR_BODY");
		if (reason !== "main ruleset types changed")
			expect(
				get.mock.calls.some(([path]) => path.includes("/rules/branches/main") || path.includes("/environments/")),
			).toBe(false);
	});
});
