import type { Candidate, GithubReleaseState, ReleaseReader, TagState, WorkspaceRelease } from "./types";

const FINAL_RELEASE_DELAYS = [1_000, 2_000, 4_000, 8_000] as const;

export type Wait = (milliseconds: number) => Promise<void>;

const normalize = (value: string) => value.replaceAll("\r\n", "\n").trim();

function compatibleHistoricalBody(candidate: Candidate, body: string): boolean {
	if (candidate.version !== "0.3.0") return false;
	return normalize(body) === `${normalize(candidate.notes)}\n\nTracking: #52`;
}

function validateTag(candidate: Candidate, tag: TagState): "create" | "none" {
	if (tag.kind === "absent") return "create";
	if (tag.kind !== "annotated") throw new Error(`${candidate.tag} is a lightweight tag`);
	if (tag.target !== candidate.releaseCommit)
		throw new Error(`${candidate.tag} targets ${tag.target}, not release commit`);
	return "none";
}

function validateRelease(candidate: Candidate, release: GithubReleaseState): "create" | "none" {
	if (release.kind === "absent") return "create";
	if (release.kind === "draft") throw new Error(`${candidate.tag} is reserved by a draft GitHub Release`);
	if (release.name !== `${candidate.name} ${candidate.version}`)
		throw new Error(`${candidate.tag} release has a conflicting name`);
	if (release.prerelease !== candidate.prerelease)
		throw new Error(`${candidate.tag} release has conflicting prerelease state`);
	if (normalize(release.body) !== normalize(candidate.notes) && !compatibleHistoricalBody(candidate, release.body)) {
		throw new Error(`${candidate.tag} release body conflicts with CHANGELOG`);
	}
	return "none";
}

export async function preflightCandidate(candidate: Candidate, reader: ReleaseReader): Promise<Candidate> {
	const [tag, release] = await Promise.all([reader.tag(candidate.tag), reader.release(candidate.tag)]);
	const tagAction = validateTag(candidate, tag);
	const releaseAction = validateRelease(candidate, release);
	if (releaseAction === "none" && tagAction === "create") {
		throw new Error(`${candidate.tag} release exists without a compatible tag`);
	}
	return { ...candidate, tagAction, releaseAction };
}

export async function selectCandidates(
	workspaces: WorkspaceRelease[],
	releaseCommit: string,
	reader: ReleaseReader,
): Promise<Candidate[]> {
	const selected: Candidate[] = [];
	for (const workspace of workspaces) {
		const npm = await reader.npmVersion(workspace.name, workspace.version);
		if (npm.exists && npm.gitHead !== releaseCommit) continue;
		selected.push({ ...workspace, releaseCommit, tagAction: "create", releaseAction: "create" });
	}
	return Promise.all(selected.map((candidate) => preflightCandidate(candidate, reader)));
}

export async function preflightAll(candidates: Candidate[], reader: ReleaseReader): Promise<Candidate[]> {
	return Promise.all(candidates.map((candidate) => preflightCandidate(candidate, reader)));
}

export async function awaitFinalReleases(candidates: Candidate[], reader: ReleaseReader, wait: Wait): Promise<void> {
	let missing = candidates.filter((candidate) => candidate.releaseAction === "create");
	for (const milliseconds of FINAL_RELEASE_DELAYS) {
		if (missing.length === 0) return;
		await wait(milliseconds);
		const checked = await Promise.all(
			missing.map(async (candidate) => ({
				candidate,
				action: validateRelease(candidate, await reader.release(candidate.tag)),
			})),
		);
		missing = checked.filter(({ action }) => action === "create").map(({ candidate }) => candidate);
	}
	if (missing.length === 0) return;
	throw new Error(
		`GitHub Releases remained missing after 5 attempts and 15000ms total backoff: ${missing
			.map((candidate) => candidate.tag)
			.join(", ")}`,
	);
}
