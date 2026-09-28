import { type GitHubRead, array, object, repo, requireThat, sameSet } from "./live-evidence-shape";

async function verifyMainRules(api: GitHubRead): Promise<void> {
	const ruleset = object(await api.get(`${repo}/rulesets/24103769`));
	const conditions = object(object(ruleset.conditions).ref_name);
	requireThat(
		ruleset.id === 24103769 &&
			ruleset.enforcement === "active" &&
			ruleset.target === "branch" &&
			ruleset.source_type === "Repository" &&
			sameSet(conditions.include, ["refs/heads/main"]) &&
			sameSet(conditions.exclude, []) &&
			sameSet(ruleset.bypass_actors, []) &&
			ruleset.current_user_can_bypass === "never",
		"main ruleset or bypass changed",
	);
	await verifyRuleDetails(api, ruleset);
}

async function verifyRuleDetails(api: GitHubRead, ruleset: Record<string, unknown>): Promise<void> {
	const rules = array(ruleset.rules).map(object);
	const required = ["deletion", "non_fast_forward", "pull_request", "required_status_checks"];
	requireThat(
		sameSet(
			rules.map((rule) => rule.type),
			required,
		),
		"main ruleset types changed",
	);
	const pr = object(rules.find((rule) => rule.type === "pull_request")?.parameters);
	requireThat(
		pr.required_approving_review_count === 0 &&
			sameSet(pr.required_reviewers, []) &&
			sameSet(pr.allowed_merge_methods, ["merge", "squash", "rebase"]),
		"PR-only main policy changed",
	);
	const checks = object(rules.find((rule) => rule.type === "required_status_checks")?.parameters);
	requireThat(
		array(checks.required_status_checks).length === 1 &&
			object(array(checks.required_status_checks)[0]).context === "ci" &&
			object(array(checks.required_status_checks)[0]).integration_id === 15368,
		"required ci app changed",
	);
	const effective = array(await api.get(`${repo}/rules/branches/main`)).map(object);
	requireThat(
		sameSet(
			effective.filter((rule) => rule.ruleset_id === 24103769).map((rule) => rule.type),
			required,
		),
		"main ruleset not effective",
	);
	const effectivePr = object(
		effective.find((rule) => rule.ruleset_id === 24103769 && rule.type === "pull_request")?.parameters,
	);
	const effectiveChecks = object(
		effective.find((rule) => rule.ruleset_id === 24103769 && rule.type === "required_status_checks")?.parameters,
	);
	requireThat(
		JSON.stringify(effectivePr) === JSON.stringify(pr) && JSON.stringify(effectiveChecks) === JSON.stringify(checks),
		"effective main parameters differ",
	);
}

async function verifyEnvironment(api: GitHubRead): Promise<void> {
	const environment = object(await api.get(`${repo}/environments/formbar-rc`));
	const branch = object(environment.deployment_branch_policy);
	requireThat(
		environment.id === 22904271021 &&
			environment.can_admins_bypass === false &&
			branch.custom_branch_policies === true &&
			branch.protected_branches === false,
		"release environment changed",
	);
	const protection = array(environment.protection_rules).map(object);
	requireThat(
		sameSet(
			protection.map((rule) => rule.type),
			["required_reviewers", "branch_policy"],
		),
		"release protection rules changed",
	);
	const reviewerRule = protection.find((rule) => rule.type === "required_reviewers");
	const reviewers = array(reviewerRule?.reviewers);
	requireThat(
		reviewerRule?.prevent_self_review === true &&
			reviewers.length === 1 &&
			object(object(reviewers[0]).reviewer).id === 806157 &&
			object(reviewers[0]).type === "User",
		"sole non-self reviewer changed",
	);
	const policies = object(await api.get(`${repo}/environments/formbar-rc/deployment-branch-policies`));
	const entries = array(policies.branch_policies);
	requireThat(
		policies.total_count === 1 &&
			entries.length === 1 &&
			object(entries[0]).name === "main" &&
			object(entries[0]).type === "branch",
		"main-only deployment policy changed",
	);
}

export async function verifyLivePolicy(api: GitHubRead): Promise<void> {
	await verifyMainRules(api);
	await verifyEnvironment(api);
}

export async function verifyEligibleActors(api: GitHubRead): Promise<void> {
	for (const [login, id] of [
		["eaglez", 1532734],
		["spralle", 806157],
	] as const) {
		const permission = object(await api.get(`${repo}/collaborators/${login}/permission`));
		requireThat(object(permission.user).id === id && permission.permission === "admin", "actor eligibility changed");
	}
}

export async function verifyCi(api: GitHubRead, commit: string): Promise<void> {
	const checks: unknown[] = [];
	for (let page = 1; page <= 20; page++) {
		const response = object(await api.get(`${repo}/commits/${commit}/check-runs?per_page=100&page=${page}`));
		const batch = array(response.check_runs);
		checks.push(...batch);
		requireThat(
			typeof response.total_count === "number" && response.total_count >= checks.length,
			"ambiguous ci pagination",
		);
		if (checks.length === response.total_count) break;
		requireThat(batch.length === 100 && page < 20, "incomplete ci pagination");
	}
	const matching = checks.map(object).filter((check) => check.name === "ci" && object(check.app).id === 15368);
	requireThat(
		matching.length === 1 &&
			matching[0].head_sha === commit &&
			matching[0].status === "completed" &&
			matching[0].conclusion === "success",
		"exact-SHA ci not uniquely green",
	);
}
