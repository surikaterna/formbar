import { type GitHubRead, array, object, repo, requireThat, sha } from "./live-evidence-shape";
import { verifyFreshGo } from "./live-go";
import { verifyCi, verifyEligibleActors, verifyLivePolicy } from "./live-policy";

export interface RunWitness {
	runId: number;
	attempt: number;
	actor: string;
	senderId: number; // From GitHub-generated workflow event, not a caller-supplied GO comment.
	repository: string;
	event: string;
	ref: string;
	workflowRef: string;
	workflowSha: string;
	eventSha: string;
	checkoutSha: string;
	checkoutTree: string;
	expectedSha: string;
}

/** Read-only snapshot. Not a publish entrypoint; re-fetch before each future write. */
export async function fetchRcEvidence(api: GitHubRead, witness: RunWitness, now: Date): Promise<{ commentId: number }> {
	verifyWitness(witness);
	const run = await verifyRunAndMain(api, witness);
	await verifyEligibleActors(api);
	await verifyLivePolicy(api);
	await verifyCi(api, witness.expectedSha);
	const commentId = await verifyFreshGo(
		api,
		witness.runId,
		String(run.created_at),
		witness.expectedSha,
		witness.checkoutTree,
		now,
	);
	await verifyApproval(api, witness.runId);
	return { commentId };
}

export function verifyWitness(witness: RunWitness): void {
	requireThat(
		Number.isSafeInteger(witness.runId) &&
			witness.runId > 0 &&
			witness.attempt === 1 &&
			witness.actor === "eaglez" &&
			witness.senderId === 1532734 &&
			witness.repository === "surikaterna/formbar" &&
			witness.event === "workflow_dispatch" &&
			witness.ref === "refs/heads/main" &&
			witness.workflowRef === "surikaterna/formbar/.github/workflows/release.yml@refs/heads/main" &&
			sha.test(witness.expectedSha) &&
			sha.test(witness.checkoutTree) &&
			[witness.workflowSha, witness.eventSha, witness.checkoutSha].every((s) => s === witness.expectedSha),
		"runtime actor, sender, workflow, ref or checkout differs",
	);
}

async function verifyRunAndMain(api: GitHubRead, witness: RunWitness): Promise<Record<string, unknown>> {
	const run = object(await api.get(`${repo}/actions/runs/${witness.runId}`));
	requireThat(
		run.id === witness.runId &&
			run.event === "workflow_dispatch" &&
			run.run_attempt === 1 &&
			object(run.actor).id === 1532734 &&
			object(run.triggering_actor).id === 1532734 &&
			run.head_sha === witness.expectedSha &&
			run.head_branch === "main" &&
			run.path === ".github/workflows/release.yml" &&
			run.workflow_id === 349257014 &&
			object(run.head_commit).tree_id === witness.checkoutTree,
		"GitHub run identity changed",
	);
	const main = object(await api.get(`${repo}/branches/main`));
	requireThat(object(main.commit).sha === witness.expectedSha, "main advanced");
	const gitCommit = object(await api.get(`${repo}/git/commits/${witness.expectedSha}`));
	requireThat(object(gitCommit.tree).sha === witness.checkoutTree, "main tree changed");
	return run;
}

async function verifyApproval(api: GitHubRead, runId: number): Promise<void> {
	const approvals = array(await api.get(`${repo}/actions/runs/${runId}/approvals`));
	requireThat(approvals.length === 1, "missing or ambiguous same-run approval");
	const approval = object(approvals[0]);
	const environments = array(approval.environments);
	requireThat(
		approval.state === "approved" &&
			object(approval.user).id === 806157 &&
			environments.length === 1 &&
			object(environments[0]).id === 22904271021 &&
			object(environments[0]).name === "formbar-rc",
		"wrong same-run reviewer or environment",
	);
}
