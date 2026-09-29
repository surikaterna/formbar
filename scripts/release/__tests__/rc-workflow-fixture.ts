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
// These prerelease sections are fixture data, not release inputs. The old fixture
// fetched blobs from #298, which are absent in a shallow checkout of this PR.
const changelogSections: Record<string, string> = {
	expressions: `### Minor Changes

- bf56976: Expose \`parseRef\` to validate and canonically copy StateRefs without flattening scoped row references.`,
	core: `### Minor Changes

- 7698998: Connect the private definition-bound checked FINAL submission attempt to the submit handler. Only an explicitly activated, real form-bound omission supplier can hand the handler the same frozen bytes validated by every FINAL validator and authorized by the retained-issue gate. Retained draft and default submission behavior are unchanged; this private integration switch does not expose a declarative omit-inactive mode or claim a callback sandbox.
- 75454ce: Add creation-time \`ownedScheduling: true\` for eager and deferred forms, including prepared schema and React factories. It validates and owns bounded JSON-compatible initial state before any initialization callback or render-visible snapshot; invalid direct writes reject before pipeline hooks, and invalid trusted callback output cannot publish. Trusted callbacks may still cause external side effects before their invalid output is detected at commit. Default forms retain existing behavior. Accepted writes replace the owned epoch while issue-only publications share it. The legacy trusted-host activation seam remains for existing integrations; caller-owned and prior snapshots remain unfrozen. In opt-in mode, each listener receives the current snapshot at invocation entry (also returned by \`getState()\` and \`captureState()\`); its argument becomes historical if its own callback writes. Reentrant commits are synchronous and may coalesce intermediate notifications for later listeners; use the current snapshot rather than expecting every intermediate state. A subscriber that continuously writes can trigger \`OWNED_NOTIFICATION_OVERFLOW\` after 1024 invocations in one drain, including when invoked by another form's subscriber; already accepted writes remain committed, and subsequent writes can notify again. No omission or release is enabled.
- 10b4eaa: Support trusted definition-scoped async instances on owned forms, with independent change/blur scheduling and guarded full-draft validation. Preserve original certified issues through issue-only publication and validation-status settlement; legacy and candidate validation remain separate.
- cd7009c: Run every configured definition-scoped async instance on the guarded post-egress FINAL candidate alongside legacy validators, even when sync validation fails. Keep candidate issues in the attempt lane and leave retained draft validation unchanged. Pass captured submit stage and context to definition-scoped async callbacks.
- ca15dcb: Own validation diagnostics at every core store ingress. Mutable caller issues are validated, detached and deeply frozen as new stored values; core-produced scoped issues keep their original certified identity. Unsupported issue graphs now fail atomically instead of entering the store. **BREAKING migration (including default forms):** stored legacy \`ValidationIssue\` objects no longer preserve caller-supplied reference identity (\`storedIssue !== suppliedIssue\`) or mutability; stored issue arrays cannot be mutated. Previously accepted non-JSON issue details and unsupported issue graphs are rejected. Read the owned issue from \`getState()\` instead of relying on the supplied reference, and supply plain, dense JSON-compatible diagnostics. This is a compatibility change classified as minor only under the below-1.0 prerelease policy, not a claim that existing consumers are unaffected. Public \`normalizeIssues\`, \`sortIssues\` and \`dedupeIssues\` remain non-owning utilities. Draft validation invocation and default retained-draft submission payloads are unchanged.

### Patch Changes

- cbb9d59: Allow the private bound submit lane to accept a real structurally verified zero-omission witness without bypassing final-candidate checks.
- 0ed966b: Track the exact private guarded FINAL sync and foreground async generation transitions, including unscoped and zero-async candidates, so competing validation cannot masquerade as the same submit attempt. Default validation and submission behavior remains unchanged.
- 1bf5761: Fail closed when independently blocking retained errors survive private final-candidate validation, while accepting only original issues covered by the bound submit receipt.
- 08c1a2b: Preserve original certified scoped-issue evidence through a metadata-only guarded submit checkpoint and bind it to the real checked final omission and attempt-owned validation generations. Snapshot both generation lanes before pipeline hooks so competing validation cannot claim the attempt's FINAL transitions. This private receipt does not activate omission or change default submission.
- 439a847: Settle a pending guarded submit as aborted when its form is disposed during async validation, without publishing late attempt metadata. Unsupported owned-state publications on live forms still fail closed.
- ed3d7c3: Keep opt-in owned scoped captures current while validation-status, owned issue, field metadata, attempt and submission-result publications deliver synchronous snapshots without consuming a semantic write or ownership epoch. Preserve original certified async issues across full-draft validation completion. Generic transactions still conservatively revoke captures; the default form mode is unchanged.
- ba13b66: Connect prepared definition-bound omission projections to the private guarded candidate checkpoint and preserve its single checked final witness for later submit work. No public submit activation is added.
- be5b55a: Provide a private definition/form-bound, single-capture omission supplier and final structural checker seam without enabling hidden-value submission or changing the default submit path.
- 81c9913: Track private scoped capture ownership across the first successful issue-only detachment while rejecting stale writes, failed publication, and external mutations to the captured baseline.
- Updated dependencies [bf56976]
  - @formbar/expressions@0.23.0-rc.0`,
	declarative: `### Minor Changes

- 10b4eaa: Add validated definition field async registrations, typed per-instance ownership projection, and fail-closed overlapping-binding checks.
- cd7009c: Run every configured definition-scoped async instance on the guarded post-egress FINAL candidate alongside legacy validators, even when sync validation fails. Keep candidate issues in the attempt lane and leave retained draft validation unchanged. Pass captured submit stage and context to definition-scoped async callbacks.
- c460d74: Expose the public trusted definition-field issue input and concrete data-binding types for authored and generated scoped validators. Document registration, full-draft and candidate execution, and legacy migration without enabling omission.
  Install prepared schema and caller validators exactly once through the eager/deferred factory; React delegates preparation validators to the factory while retaining its separate Standard Schema source validation.
- ceaf702: Validate and retain an optional serialized hidden-values submission policy and field-only include-hidden override, and project the override onto each concrete field instance. This does not activate omission or change default submission.

### Patch Changes

- b4340af: Certify existing typed descendant diagnostics from uniquely bound object fields against the callback's draft or FINAL candidate data, without making unknown sibling data eligible for omission.
- 08c1a2b: Preserve original certified scoped-issue evidence through a metadata-only guarded submit checkpoint and bind it to the real checked final omission and attempt-owned validation generations. Snapshot both generation lanes before pipeline hooks so competing validation cannot claim the attempt's FINAL transitions. This private receipt does not activate omission or change default submission.
- ba13b66: Connect prepared definition-bound omission projections to the private guarded candidate checkpoint and preserve its single checked final witness for later submit work. No public submit activation is added.
- be5b55a: Provide a private definition/form-bound, single-capture omission supplier and final structural checker seam without enabling hidden-value submission or changing the default submit path.
- Updated dependencies [cbb9d59]
- Updated dependencies [7698998]
- Updated dependencies [0ed966b]
- Updated dependencies [1bf5761]
- Updated dependencies [08c1a2b]
- Updated dependencies [439a847]
- Updated dependencies [75454ce]
- Updated dependencies [ed3d7c3]
- Updated dependencies [ba13b66]
- Updated dependencies [be5b55a]
- Updated dependencies [bf56976]
- Updated dependencies [10b4eaa]
- Updated dependencies [cd7009c]
- Updated dependencies [81c9913]
- Updated dependencies [ca15dcb]
  - @formbar/core@0.23.0-rc.0
  - @formbar/expressions@0.23.0-rc.0`,
	"from-schema": `### Minor Changes

- 70f01ad: Enable validated definition-bound omit-inactive submission through prepared schema factories and forward the opt-in from useSchemaForm. Generated definitions accept a serialized submission policy and field-ID include-hidden overrides; default full-draft submission is unchanged.
- 10b4eaa: Expose prepared authored/generated async field validators, reject duplicate legacy IDs before form creation, and enable owned scheduling before eager or deferred initialization.
- c460d74: Expose the public trusted definition-field issue input and concrete data-binding types for authored and generated scoped validators. Document registration, full-draft and candidate execution, and legacy migration without enabling omission.
  Install prepared schema and caller validators exactly once through the eager/deferred factory; React delegates preparation validators to the factory while retaining its separate Standard Schema source validation.

### Patch Changes

- be5b55a: Provide a private definition/form-bound, single-capture omission supplier and final structural checker seam without enabling hidden-value submission or changing the default submit path.
- Updated dependencies [cbb9d59]
- Updated dependencies [b4340af]
- Updated dependencies [7698998]
- Updated dependencies [0ed966b]
- Updated dependencies [1bf5761]
- Updated dependencies [08c1a2b]
- Updated dependencies [439a847]
- Updated dependencies [75454ce]
- Updated dependencies [ed3d7c3]
- Updated dependencies [ba13b66]
- Updated dependencies [be5b55a]
- Updated dependencies [bf56976]
- Updated dependencies [10b4eaa]
- Updated dependencies [10b4eaa]
- Updated dependencies [cd7009c]
- Updated dependencies [81c9913]
- Updated dependencies [c460d74]
- Updated dependencies [ca15dcb]
- Updated dependencies [ceaf702]
  - @formbar/core@0.23.0-rc.0
  - @formbar/declarative@0.23.0-rc.0
  - @formbar/expressions@0.23.0-rc.0`,
	react: `### Patch Changes

- Updated dependencies [cbb9d59]
- Updated dependencies [7698998]
- Updated dependencies [0ed966b]
- Updated dependencies [1bf5761]
- Updated dependencies [08c1a2b]
- Updated dependencies [439a847]
- Updated dependencies [75454ce]
- Updated dependencies [ed3d7c3]
- Updated dependencies [ba13b66]
- Updated dependencies [be5b55a]
- Updated dependencies [bf56976]
- Updated dependencies [10b4eaa]
- Updated dependencies [cd7009c]
- Updated dependencies [81c9913]
- Updated dependencies [ca15dcb]
  - @formbar/core@0.23.0-rc.0
  - @formbar/expressions@0.23.0-rc.0`,
	"react-schema": `### Minor Changes

- 70f01ad: Enable validated definition-bound omit-inactive submission through prepared schema factories and forward the opt-in from useSchemaForm. Generated definitions accept a serialized submission policy and field-ID include-hidden overrides; default full-draft submission is unchanged.
- 772a12e: Surface failed checked outgoing-candidate validation in native form summaries and field errors so opted-in schema forms can guide users to correct the actual submitted request.
- 10b4eaa: Forward prepared async field validator options through the deferred schema-form hook without changing the React core form API.

### Patch Changes

- c460d74: Expose the public trusted definition-field issue input and concrete data-binding types for authored and generated scoped validators. Document registration, full-draft and candidate execution, and legacy migration without enabling omission.
  Install prepared schema and caller validators exactly once through the eager/deferred factory; React delegates preparation validators to the factory while retaining its separate Standard Schema source validation.
- Updated dependencies [cbb9d59]
- Updated dependencies [b4340af]
- Updated dependencies [7698998]
- Updated dependencies [0ed966b]
- Updated dependencies [1bf5761]
- Updated dependencies [08c1a2b]
- Updated dependencies [439a847]
- Updated dependencies [75454ce]
- Updated dependencies [ed3d7c3]
- Updated dependencies [70f01ad]
- Updated dependencies [ba13b66]
- Updated dependencies [be5b55a]
- Updated dependencies [10b4eaa]
- Updated dependencies [10b4eaa]
- Updated dependencies [10b4eaa]
- Updated dependencies [cd7009c]
- Updated dependencies [81c9913]
- Updated dependencies [c460d74]
- Updated dependencies [ca15dcb]
- Updated dependencies [ceaf702]
  - @formbar/core@0.23.0-rc.0
  - @formbar/declarative@0.23.0-rc.0
  - @formbar/from-schema@0.23.0-rc.0
  - @formbar/react@0.23.0-rc.0`,
	arbiter: `### Patch Changes

- Updated dependencies [cbb9d59]
- Updated dependencies [7698998]
- Updated dependencies [0ed966b]
- Updated dependencies [1bf5761]
- Updated dependencies [08c1a2b]
- Updated dependencies [439a847]
- Updated dependencies [75454ce]
- Updated dependencies [ed3d7c3]
- Updated dependencies [ba13b66]
- Updated dependencies [be5b55a]
- Updated dependencies [bf56976]
- Updated dependencies [10b4eaa]
- Updated dependencies [cd7009c]
- Updated dependencies [81c9913]
- Updated dependencies [ca15dcb]
  - @formbar/core@0.23.0-rc.0
  - @formbar/expressions@0.23.0-rc.0`,
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
		const baseline = readFileSync(join(root, "packages", name, "CHANGELOG.md"), "utf8");
		const heading = `# @formbar/${name}\n\n`;
		if (!baseline.startsWith(heading)) throw new Error(`unexpected baseline changelog ${name}`);
		writeFileSync(
			join(path, "CHANGELOG.md"),
			`${heading}## ${rcVersion}\n\n${changelogSections[name]}\n\n${baseline.slice(heading.length)}`,
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
