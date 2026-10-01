import { type GitHubRead, object, repo, requireThat, sha } from "./live-evidence-shape";
import { verifyCi, verifyEligibleActors, verifyLivePolicy } from "./live-policy";

export interface RunWitness {
	runId: number;
	attempt: number;
	actor: string;
	senderId: number; // From the GitHub-generated workflow event.
	repository: string;
	repositoryId: string;
	repositoryOwnerId: string;
	event: string;
	ref: string;
	refProtected: string;
	workflowRef: string;
	workflowSha: string;
	eventSha: string;
	checkoutSha: string;
	checkoutTree: string;
	expectedSha: string;
}

/** Read-only snapshot. Not a publish entrypoint; re-fetch before each future write. */
export async function fetchRcEvidence(api: GitHubRead, witness: RunWitness): Promise<void> {
	verifyWitness(witness);
	await verifyRunAndMain(api, witness);
	await verifyEligibleActors(api);
	await verifyLivePolicy(api);
	await verifyCi(api, witness.expectedSha);
}

function verifyWitness(witness: RunWitness): void {
	requireThat(
		Number.isSafeInteger(witness.runId) &&
			witness.runId > 0 &&
			witness.attempt === 1 &&
			witness.actor === "spralle" &&
			witness.senderId === 806157 &&
			witness.repository === "surikaterna/formbar" &&
			witness.repositoryId === "1245476636" &&
			witness.repositoryOwnerId === "9478205" &&
			witness.event === "workflow_dispatch" &&
			witness.ref === "refs/heads/main" &&
			witness.refProtected === "true" &&
			witness.workflowRef === "surikaterna/formbar/.github/workflows/release.yml@refs/heads/main" &&
			sha.test(witness.expectedSha) &&
			sha.test(witness.checkoutTree) &&
			[witness.workflowSha, witness.eventSha, witness.checkoutSha].every((s) => s === witness.expectedSha),
		"runtime actor, sender, workflow, ref or checkout differs",
	);
}

async function verifyRunAndMain(api: GitHubRead, witness: RunWitness): Promise<void> {
	const run = object(await api.get(`${repo}/actions/runs/${witness.runId}`));
	const repository = object(run.repository);
	const owner = object(repository.owner);
	requireThat(
		run.id === witness.runId &&
			repository.full_name === witness.repository &&
			repository.id === 1245476636 &&
			owner.login === "surikaterna" &&
			owner.id === 9478205 &&
			run.event === "workflow_dispatch" &&
			run.run_attempt === 1 &&
			object(run.actor).id === 806157 &&
			object(run.triggering_actor).id === 806157 &&
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
}
