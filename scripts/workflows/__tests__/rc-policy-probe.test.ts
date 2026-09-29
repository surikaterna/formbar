import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const source = readFileSync(new URL("../../../.github/workflows/rc-policy-probe.yml", import.meta.url), "utf8");
const workflow = parse(source);
const step = workflow.jobs.probe.steps[0];
const script = /^node <<'NODE'\n([\s\S]*)\nNODE\n?$/.exec(step.run)?.[1];
const sha = "a".repeat(40);
const pr = {
	required_approving_review_count: 0,
	required_reviewers: [],
	allowed_merge_methods: ["merge", "squash", "rebase"],
};
const ci = { required_status_checks: [{ context: "ci", integration_id: 15368 }] };
const types = ["deletion", "non_fast_forward", "pull_request", "required_status_checks"];
const rules = types.map((type) => ({
	type,
	parameters: type === "pull_request" ? pr : type === "required_status_checks" ? ci : {},
}));
const policy = {
	id: 24103769,
	enforcement: "active",
	target: "branch",
	source_type: "Repository",
	conditions: { ref_name: { include: ["refs/heads/main"], exclude: [] } },
	bypass_actors: [],
	current_user_can_bypass: "never",
	rules,
};
const effective = rules.map((rule) => ({ ...rule, ruleset_id: 24103769 }));

// Run the actual inline script; the mock denies any unexpected network destination or method.
const mock = `
const responses = JSON.parse(process.env.MOCK_RESPONSES);
globalThis.fetch = async (url, options) => {
  if (options.method !== 'GET') throw Error('forbidden method');
  if (options.redirect !== 'error' || !options.signal ||
      !url.startsWith('https://api.github.com/repos/surikaterna/formbar/')) throw Error('forbidden request');
  if (options.headers.Authorization !== 'Bearer SECRET_TOKEN' ||
      options.headers.Accept !== 'application/vnd.github+json' ||
      options.headers['X-GitHub-Api-Version'] !== '2022-11-28') throw Error('forbidden headers');
  const path = url.slice('https://api.github.com/repos/surikaterna/formbar/'.length);
  if (!['git/ref/heads/main', 'rulesets/24103769', 'rules/branches/main'].includes(path)) throw Error('forbidden path');
  const item = responses[path];
  if (item === undefined) throw Error('unexpected request');
  if (item === 'NETWORK') throw Error('network leak SECRET_BODY');
  return new Response(JSON.stringify(item === 'HTTP' ? 'SECRET_BODY' : item), {
    status: item === 'HTTP' ? 403 : 200,
  });
};
`;

function run(overrides: Record<string, unknown> = {}, env: Record<string, string> = {}) {
	const responses = {
		"git/ref/heads/main": { object: { sha } },
		"rulesets/24103769": policy,
		"rules/branches/main": effective,
		...overrides,
	};
	const result = spawnSync("node", ["-e", `${mock}\n${script}`], {
		encoding: "utf8",
		env: {
			...process.env,
			MOCK_RESPONSES: JSON.stringify(responses),
			GITHUB_TOKEN: "SECRET_TOKEN",
			GITHUB_REPOSITORY: "surikaterna/formbar",
			GITHUB_EVENT_NAME: "workflow_dispatch",
			GITHUB_REF: "refs/heads/main",
			GITHUB_ACTOR: "spralle",
			TRIGGERING_ACTOR: "spralle",
			GITHUB_RUN_ATTEMPT: "1",
			GITHUB_SHA: sha,
			EXPECTED_MAIN_SHA: sha,
			...env,
		},
	});
	const output = result.stdout + result.stderr;
	expect(output).not.toMatch(/SECRET|Bearer|api\.github\.com|spralle|headers|stack|Error:/i);
	expect(result.stderr).toBe("");
	for (const line of result.stdout.trim().split("\n")) {
		expect(line).toMatch(
			/^(IDENTITY_DENIED|MAIN_(HTTP|SIZE|ERROR|SHAPE|MISMATCH)|RULESET_(HTTP|SIZE|ERROR|SHAPE)|EFFECTIVE_(HTTP|SIZE|ERROR|SHAPE)|PROBE_ERROR|(?:IDENTITY|ACTIVE|BRANCH|REPOSITORY|MAIN_ONLY|BYPASS_EMPTY|CALLER_NEVER|RULE_TYPES|PR_ZERO|CI_APP|EFFECTIVE_TYPES|EFFECTIVE_PR|EFFECTIVE_CI)=(true|false))$/,
		);
	}
	return result;
}

describe("#413 isolated policy visibility probe", () => {
	it("parses the real manual-only workflow with only read permission and no external steps", () => {
		expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
		expect(workflow.on.workflow_dispatch.inputs).toEqual({
			expected_main_sha: {
				description: expect.any(String),
				required: true,
				type: "string",
			},
		});
		expect(workflow.permissions).toEqual({ contents: "read" });
		expect(workflow.jobs.probe.permissions).toEqual({ contents: "read" });
		expect(workflow.jobs.probe.environment).toBeUndefined();
		expect(workflow.jobs.probe.if).toBe(
			"github.repository == 'surikaterna/formbar' && github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && github.actor == 'spralle' && github.triggering_actor == 'spralle' && github.run_attempt == 1",
		);
		expect(workflow.jobs.probe.steps).toHaveLength(1);
		expect(step.shell).toBe("bash");
		expect(step.env).toEqual({
			GITHUB_TOKEN: "${{ github.token }}",
			EXPECTED_MAIN_SHA: "${{ inputs.expected_main_sha }}",
			TRIGGERING_ACTOR: "${{ github.triggering_actor }}",
		});
		expect(script).toBeTruthy();
		expect(source).not.toMatch(/uses:|id-token:|secrets\.|npm |bun |git fetch|workflow_call|schedule:/);
	});

	it("reports only true fixed predicates with complete positive policy evidence", () => {
		const result = run();
		expect(result.status).toBe(0);
		expect(result.stdout.trim().split("\n")).toHaveLength(13);
		expect(result.stdout).not.toContain("false");
	});

	it.each([
		["public null", { ...policy, bypass_actors: null, current_user_can_bypass: null }],
		["partial", { ...policy, rules: rules.slice(2) }],
		["missing", { ...policy, bypass_actors: undefined }],
		["malformed", { ...policy, bypass_actors: {}, conditions: null }],
		["nonempty", { ...policy, bypass_actors: [{ actor_id: 806157 }] }],
		[
			"weakened",
			{
				...policy,
				enforcement: "disabled",
				rules: rules.map((rule) =>
					rule.type === "pull_request" ? { ...rule, parameters: { ...pr, required_approving_review_count: 1 } } : rule,
				),
			},
		],
	])("fails closed for %s ruleset", (_name, changed) => {
		const result = run({ "rulesets/24103769": changed });
		expect(result.status).toBe(1);
		expect(result.stdout).toContain("false");
	});

	it.each([
		["effective drift", { "rules/branches/main": effective.slice(1) }, {}],
		["ruleset 403", { "rulesets/24103769": "HTTP" }, {}],
		["network", { "rulesets/24103769": "NETWORK" }, {}],
		["null ruleset", { "rulesets/24103769": null }, {}],
		["null effective", { "rules/branches/main": null }, {}],
		["main drift", { "git/ref/heads/main": { object: { sha: "b".repeat(40) } } }, {}],
		["wrong SHA", {}, { EXPECTED_MAIN_SHA: "b".repeat(40) }],
		["invalid SHA", {}, { EXPECTED_MAIN_SHA: "A".repeat(40), GITHUB_SHA: "A".repeat(40) }],
		["wrong actor", {}, { TRIGGERING_ACTOR: "other" }],
		["wrong initial actor", {}, { GITHUB_ACTOR: "other" }],
		["wrong ref", {}, { GITHUB_REF: "refs/heads/other" }],
		["wrong repository", {}, { GITHUB_REPOSITORY: "other/repo" }],
		["rerun", {}, { GITHUB_RUN_ATTEMPT: "2" }],
	] as const)("denies %s without exposing evidence", (_name, responses, env) => {
		expect(run(responses, env).status).toBe(1);
	});
});
