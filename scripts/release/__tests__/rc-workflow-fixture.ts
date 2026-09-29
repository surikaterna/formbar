import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { consumed, initialVersions, rcEdges, rcPackages, rcVersion } from "../rc-reviewed-plan";

const repo = "repos/surikaterna/formbar";
const rules = ["deletion", "non_fast_forward", "pull_request", "required_status_checks"];
const pr = {
	required_approving_review_count: 0,
	required_reviewers: [],
	allowed_merge_methods: ["merge", "squash", "rebase"],
};
const checks = { required_status_checks: [{ context: "ci", integration_id: 15368 }] };
const runId = 12345;
const changelogs: Record<string, string> = {
	expressions: "be08f4e1336173f88cd3d935831f54f7255cba0e",
	core: "7bedaf047cdfca22ea671c24852bbce304be0384",
	arbiter: "2b7e0c86afb713009762be3b720f04431b8915b5",
	declarative: "32394386b02997398384b925c6a204909f5a23ff",
	"from-schema": "8afd4c3f2c1aa351263d59b61b2d7a01d50f42cc",
	react: "79d8556af213b8b072b8fcb6768ac40ce093eeb5",
	"react-schema": "f66832eddc616c87a6f5fe593bb55bd4906e169c",
};

export function versionedCheckout(root: string, dir: string, variant?: "wrong version" | "wrong IDs") {
	const checkout = join(dir, "checkout");
	mkdirSync(join(checkout, ".changeset"), { recursive: true });
	writeFileSync(
		join(checkout, ".changeset/pre.json"),
		JSON.stringify({
			mode: "pre",
			tag: "rc",
			changesets: variant === "wrong IDs" ? consumed.slice(1) : consumed,
			initialVersions,
		}),
	);
	for (const name of rcPackages) {
		const path = join(checkout, "packages", name);
		mkdirSync(path, { recursive: true });
		const manifest = JSON.parse(readFileSync(join(root, "packages", name, "package.json"), "utf8"));
		manifest.version = variant === "wrong version" && name === "expressions" ? "0.23.0-rc.1" : rcVersion;
		for (const dep of rcEdges[name]) manifest.dependencies[`@formbar/${dep}`] = `^${rcVersion}`;
		writeFileSync(join(path, "package.json"), JSON.stringify(manifest));
		writeFileSync(
			join(path, "CHANGELOG.md"),
			execFileSync("git", ["cat-file", "blob", changelogs[name]], { cwd: root }),
		);
	}
	mkdirSync(join(checkout, "scripts/release"), { recursive: true });
	cpSync(join(root, "scripts/release/rc-preflight.mjs"), join(checkout, "scripts/release/rc-preflight.mjs"));
	execFileSync("git", ["init", "--quiet", "--template=/dev/null", checkout]);
	execFileSync("git", ["add", "."], { cwd: checkout });
	execFileSync(
		"git",
		["-c", "user.name=fixture", "-c", "user.email=fixture@example.test", "commit", "--quiet", "-m", "fixture"],
		{ cwd: checkout },
	);
	const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: checkout, encoding: "utf8" }).trim();
	const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: checkout, encoding: "utf8" }).trim();
	return { checkout, sha, tree };
}

function runResponses(sha: string, tree: string, created: string): Record<string, unknown> {
	return {
		[`${repo}/actions/runs/${runId}`]: {
			id: runId,
			event: "workflow_dispatch",
			run_attempt: 1,
			actor: { id: 1532734 },
			triggering_actor: { id: 1532734 },
			head_sha: sha,
			head_branch: "main",
			path: ".github/workflows/release.yml",
			workflow_id: 349257014,
			created_at: created,
			head_commit: { tree_id: tree },
		},
		[`${repo}/branches/main`]: { commit: { sha } },
		[`${repo}/git/commits/${sha}`]: { tree: { sha: tree } },
		[`${repo}/collaborators/eaglez/permission`]: { user: { id: 1532734 }, permission: "admin" },
		[`${repo}/collaborators/spralle/permission`]: { user: { id: 806157 }, permission: "admin" },
	};
}

function policyResponses(sha: string): Record<string, unknown> {
	return {
		[`${repo}/rulesets/24103769`]: {
			id: 24103769,
			target: "branch",
			source_type: "Repository",
			enforcement: "active",
			conditions: { ref_name: { include: ["refs/heads/main"], exclude: [] } },
			bypass_actors: [],
			current_user_can_bypass: "never",
			rules: rules.map((type) => ({
				type,
				parameters: type === "pull_request" ? pr : type === "required_status_checks" ? checks : undefined,
			})),
		},
		[`${repo}/rules/branches/main`]: rules.map((type) => ({
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
			branch_policies: [{ name: "main", type: "branch" }],
		},
		[`${repo}/commits/${sha}/check-runs?per_page=100&page=1`]: {
			total_count: 1,
			check_runs: [{ name: "ci", head_sha: sha, status: "completed", conclusion: "success", app: { id: 15368 } }],
		},
	};
}

export function endpointResponses(sha: string, tree: string, now: Date): Record<string, unknown> {
	const created = new Date(now.getTime() - 120_000).toISOString();
	const posted = new Date(now.getTime() - 60_000).toISOString();
	const go = {
		run_id: runId,
		attempt: 1,
		sha,
		tree,
		versions: Object.fromEntries(
			rcPackages.map((name) => [
				`@formbar/${name}`,
				{
					version: rcVersion,
					dependencies: Object.fromEntries(rcEdges[name].map((dep) => [`@formbar/${dep}`, `^${rcVersion}`])),
				},
			]),
		),
		acknowledges_legacy_validation_issue:
			"I acknowledge the global/default legacy ValidationIssue identity, mutability and non-JSON shape migration.",
	};
	const comment = {
		id: 456,
		issue_url: `https://api.github.com/${repo}/issues/250`,
		user: { id: 806157 },
		created_at: posted,
		updated_at: posted,
		body: `FINAL GO\n${JSON.stringify(go)}`,
	};
	return {
		...runResponses(sha, tree, created),
		...policyResponses(sha),
		[`${repo}/issues/250/comments?per_page=100&page=1`]: [comment],
		[`${repo}/issues/comments/456`]: comment,
		[`${repo}/actions/runs/${runId}/approvals`]: [
			{ state: "approved", user: { id: 806157 }, environments: [{ id: 22904271021, name: "formbar-rc" }] },
		],
	};
}

export function approvedPreflight(): string[] {
	const root = resolve(".");
	const dir = mkdtempSync(join(tmpdir(), "formbar-rc-approved-"));
	try {
		const { checkout, sha, tree } = versionedCheckout(root, dir);
		const responses = join(dir, "responses.json");
		const requests = join(dir, "requests.log");
		const event = join(dir, "event.json");
		writeFileSync(responses, JSON.stringify(endpointResponses(sha, tree, new Date())));
		writeFileSync(requests, "");
		writeFileSync(event, JSON.stringify({ sender: { id: 1532734 }, inputs: { expected_main_sha: sha } }));
		execFileSync(
			process.execPath,
			["--import", join(root, "scripts/release/__tests__/rc-fetch-hook.mjs"), "scripts/release/rc-preflight.mjs"],
			{
				cwd: checkout,
				env: {
					...process.env,
					RC_TEST_RESPONSES: responses,
					RC_TEST_REQUESTS: requests,
					GITHUB_TOKEN: "fake-read-token",
					GITHUB_EVENT_PATH: event,
					GITHUB_RUN_ID: "12345",
					GITHUB_RUN_ATTEMPT: "1",
					GITHUB_ACTOR: "eaglez",
					GITHUB_SHA: sha,
					GITHUB_REPOSITORY: "surikaterna/formbar",
					GITHUB_EVENT_NAME: "workflow_dispatch",
					GITHUB_REF: "refs/heads/main",
					GITHUB_WORKFLOW_REF: "surikaterna/formbar/.github/workflows/release.yml@refs/heads/main",
					GITHUB_WORKFLOW_SHA: sha,
					ACTIONS_ID_TOKEN_REQUEST_URL: "https://oidc.fixture.invalid/token",
				},
			},
		);
		return readFileSync(requests, "utf8").trim().split("\n");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
