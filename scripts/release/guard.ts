import type { ReleasePlan, ReleaseReader } from "./types";

export interface DispatchContext {
	event: string;
	repository: string;
	ref: string;
	workflowRef: string;
	workflowSha: string;
	eventSha: string;
	checkoutSha: string;
	liveMainSha: string;
	expectedSha: string;
}

const expectedNames = new Set(
	["core", "arbiter", "declarative", "from-schema", "react", "react-schema"].map((name) => `@formbar/${name}`),
);

export async function checkRcCandidate(
	context: DispatchContext,
	plan: ReleasePlan,
	reader: ReleaseReader,
): Promise<void> {
	if (context.event !== "workflow_dispatch" || context.repository !== "surikaterna/formbar") {
		throw new Error("Release requires an authorized dispatch in surikaterna/formbar");
	}
	if (
		context.ref !== "refs/heads/main" ||
		context.workflowRef !== "surikaterna/formbar/.github/workflows/release.yml@refs/heads/main"
	) {
		throw new Error("Release workflow must run from main");
	}
	if (!/^[0-9a-f]{40}$/.test(context.expectedSha)) throw new Error("Expected SHA must be full and lowercase");
	if (
		[context.workflowSha, context.eventSha, context.checkoutSha, context.liveMainSha].some(
			(sha) => sha !== context.expectedSha,
		)
	)
		throw new Error("Workflow, event, checkout and live main must match the reviewed SHA");
	if (
		plan.repository !== context.repository ||
		plan.releaseCommit !== context.expectedSha ||
		plan.candidates.length !== 6
	) {
		throw new Error("Release plan does not match the six-package reviewed commit");
	}
	const names = new Set(plan.candidates.map(({ name }) => name));
	if (names.size !== 6 || [...names].some((name) => !expectedNames.has(name))) {
		throw new Error("Unexpected release package set");
	}
	for (const candidate of plan.candidates) {
		if (
			candidate.version !== "0.23.0-rc.0" ||
			!candidate.prerelease ||
			candidate.releaseCommit !== context.expectedSha ||
			candidate.tag !== `${candidate.name}@${candidate.version}`
		)
			throw new Error("Only the reviewed rc.0 candidate is eligible");
		const npm = await reader.npmVersion(candidate.name, candidate.version);
		if (npm.exists && npm.gitHead !== context.expectedSha) {
			throw new Error(`${candidate.tag} has a conflicting or missing registry gitHead`);
		}
	}
}

export function requireReleaseAuthority(): never {
	throw new Error(
		"#350: publishing disabled until protected non-self approval and #250 final GO are independently verified",
	);
}
