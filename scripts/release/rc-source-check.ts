import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type DispatchContext, checkRcCandidate } from "./guard";
import { preflightAll } from "./preflight";
import type { ReadOnlyTransport } from "./rc-live-reads";
import { checkChangelog, checkManifest, checkPre, rcEdges, rcPackages, rcVersion } from "./rc-reviewed-plan";
import type { ReleasePlan, ReleaseReader } from "./types";

const shaPattern = /^[0-9a-f]{40}$/;
export { consumed } from "./rc-reviewed-plan";

export interface ReviewedSource {
	base: string;
	head: string;
	observedBase: string;
	observedHead: string;
	versionTree: string;
	observedVersionTree: string;
	mainTree: string;
	reviewedMainTree: string;
	mergeCommit: string;
	changedFiles: { filename: string; sha: string; status: string }[];
	consentCommentId: number;
}

export interface GoEvidence {
	repository: string;
	issue: number;
	commentId: number;
	runId: number;
	runAttempt: number;
	runCreatedAt: string;
	author: string;
	signer: string;
	createdAt: string;
	updatedAt: string;
	expiresAt: string;
	checkedAt: string;
	commit: string;
	tree: string;
	base: string;
	head: string;
	mergeCommit: string;
	acknowledgesLegacyIssueMigration: boolean;
	versions: string[];
	ranges: Record<string, Record<string, string>>;
	distTag: string;
	provenance: boolean;
}

export interface ReviewContract {
	environment: string;
	protectedMain: boolean;
	noBypass: boolean;
	protectedBranchesOnly: boolean;
	preventSelfReview: boolean;
	runId: number;
	approvedRunId: number;
	dispatcher: string;
	reviewer: string;
	goSigner: string;
	runAttempt: number;
}

function requireReviewedSource(source: ReviewedSource): void {
	if (
		![source.base, source.head, source.versionTree, source.mainTree, source.reviewedMainTree, source.mergeCommit].every(
			(s) => shaPattern.test(s),
		) ||
		source.base !== source.observedBase ||
		source.head !== source.observedHead ||
		source.versionTree !== source.observedVersionTree ||
		source.mainTree !== source.reviewedMainTree ||
		source.mergeCommit === source.head ||
		!Number.isSafeInteger(source.consentCommentId) ||
		source.consentCommentId <= 0 ||
		!source.changedFiles.length ||
		source.changedFiles.length > 100 ||
		source.changedFiles.some((file) => !shaPattern.test(file.sha) || !file.filename || !file.status)
	)
		throw new Error("Reviewed #298 base/head/version tree or post-merge main tree differs");
}

function requireGo(go: GoEvidence, source: ReviewedSource, context: DispatchContext): void {
	const created = Date.parse(go.createdAt);
	const expires = Date.parse(go.expiresAt);
	const now = Date.parse(go.checkedAt);
	const runCreated = Date.parse(go.runCreatedAt);
	if (
		go.repository !== "surikaterna/formbar" ||
		go.issue !== 250 ||
		!Number.isSafeInteger(go.commentId) ||
		go.commentId <= 0 ||
		!Number.isSafeInteger(go.runId) ||
		go.runId <= 0 ||
		go.runAttempt !== 1 ||
		!go.signer ||
		go.author !== go.signer ||
		go.createdAt !== go.updatedAt ||
		!Number.isFinite(created) ||
		!Number.isFinite(expires) ||
		!Number.isFinite(now) ||
		!Number.isFinite(runCreated) ||
		created <= runCreated ||
		created > now ||
		now >= expires ||
		expires > created + 86_400_000 ||
		go.commit !== context.expectedSha ||
		go.tree !== source.mainTree ||
		go.base !== source.base ||
		go.head !== source.head ||
		go.mergeCommit !== source.mergeCommit ||
		!go.acknowledgesLegacyIssueMigration ||
		go.distTag !== "rc" ||
		!go.provenance ||
		JSON.stringify(go.versions) !== JSON.stringify(rcPackages.map((name) => `@formbar/${name}@${rcVersion}`)) ||
		JSON.stringify(go.ranges) !==
			JSON.stringify(
				Object.fromEntries(
					rcPackages.map((name) => [
						`@formbar/${name}`,
						Object.fromEntries(rcEdges[name].map((edge) => [`@formbar/${edge}`, `^${rcVersion}`])),
					]),
				),
			)
	)
		throw new Error("Missing, edited, stale or mismatched #250 FINAL GO evidence");
}

const api = "https://api.github.com/repos/surikaterna/formbar";
type Json = Record<string, unknown>;
async function github(read: ReadOnlyTransport, path: string): Promise<Json> {
	const reply = await read.get(`${api}${path}`);
	if (
		reply.status !== 200 ||
		reply.location ||
		!reply.body ||
		typeof reply.body !== "object" ||
		Array.isArray(reply.body)
	)
		throw new Error("authenticated GitHub evidence unavailable");
	return reply.body as Json;
}

async function checkPrDiff(read: ReadOnlyTransport, source: ReviewedSource): Promise<Json> {
	const pr = await github(read, "/pulls/298");
	const head = pr.head as Json;
	const base = pr.base as Json;
	if (
		head?.sha !== source.head ||
		base?.sha !== source.base ||
		pr.merged !== true ||
		pr.merge_commit_sha !== source.mergeCommit ||
		pr.state !== "closed"
	)
		throw new Error("#298 current PR identity drift");
	const version = await github(read, `/git/commits/${source.head}`);
	if ((version.tree as Json)?.sha !== source.versionTree) throw new Error("#298 version tree drift");
	const files = await read.get(`${api}/pulls/298/files?per_page=100`);
	if (
		files.status !== 200 ||
		files.location ||
		!Array.isArray(files.body) ||
		files.body.length !== source.changedFiles.length ||
		Number(pr.changed_files) !== files.body.length ||
		JSON.stringify(
			files.body
				.map((f: Json) => ({ filename: String(f.filename), sha: f.sha, status: f.status }))
				.sort((a, b) => a.filename.localeCompare(b.filename)),
		) !== JSON.stringify([...source.changedFiles].sort((a, b) => a.filename.localeCompare(b.filename)))
	)
		throw new Error("#298 reviewed diff drift");
	return pr;
}

async function checkOwnerConsent(read: ReadOnlyTransport, source: ReviewedSource, pr: Json): Promise<void> {
	const comment = await github(read, `/issues/comments/${source.consentCommentId}`);
	let consent: Json;
	try {
		consent = JSON.parse(String(comment.body)) as Json;
	} catch {
		throw new Error("missing owner premerge consent");
	}
	if (
		comment.id !== source.consentCommentId ||
		(comment.user as Json)?.login !== "spralle" ||
		(comment.user as Json)?.id !== 806157 ||
		comment.issue_url !== `${api}/issues/298` ||
		comment.created_at !== comment.updated_at ||
		!Number.isFinite(Date.parse(String(comment.created_at))) ||
		!Number.isFinite(Date.parse(String(pr.merged_at))) ||
		Date.parse(String(comment.created_at)) >= Date.parse(String(pr.merged_at)) ||
		consent.base !== source.base ||
		consent.head !== source.head ||
		consent.tree !== source.versionTree ||
		JSON.stringify(consent.files) !== JSON.stringify(source.changedFiles)
	)
		throw new Error("missing owner premerge consent");
}

async function checkMerge(read: ReadOnlyTransport, source: ReviewedSource, go: GoEvidence, context: DispatchContext) {
	const merge = await github(read, `/commits/${source.mergeCommit}`);
	const parents = merge.parents as Json[];
	if (
		!Array.isArray(parents) ||
		parents.length !== 2 ||
		parents[0]?.sha !== source.base ||
		parents[1]?.sha !== source.head ||
		(merge.commit as Json)?.tree === undefined ||
		((merge.commit as Json).tree as Json).sha !== source.mainTree
	)
		throw new Error("unreviewed merge ancestry or tree");
	const main = await github(read, "/commits/main");
	if (
		main.sha !== source.mergeCommit ||
		((main.commit as Json)?.tree as Json)?.sha !== source.mainTree ||
		context.expectedSha !== source.mergeCommit ||
		go.commit !== source.mergeCommit
	)
		throw new Error("protected main drift");
}

async function checkLiveGo(read: ReadOnlyTransport, go: GoEvidence, source: ReviewedSource) {
	const comment = await github(read, `/issues/comments/${go.commentId}`);
	const run = await github(read, `/actions/runs/${go.runId}/attempts/${go.runAttempt}`);
	if (
		comment.id !== go.commentId ||
		comment.issue_url !== `${api}/issues/250` ||
		(comment.user as Json)?.id !== 806157 ||
		(comment.user as Json)?.login !== go.signer ||
		comment.created_at !== go.createdAt ||
		comment.updated_at !== go.createdAt ||
		comment.body !== `FINAL GO\n${JSON.stringify(go)}` ||
		run.id !== go.runId ||
		run.run_attempt !== go.runAttempt ||
		run.created_at !== go.runCreatedAt ||
		run.head_sha !== source.mergeCommit ||
		run.head_branch !== "main"
	)
		throw new Error("unverified live #250 run-bound GO");
}

/** Read-only handoff: a new bot refresh MUST have its own exact-head owner consent. */
export async function inspectLiveReviewedSource(
	read: ReadOnlyTransport,
	source: ReviewedSource,
	go: GoEvidence,
	context: DispatchContext,
): Promise<void> {
	requireReviewedSource(source);
	const pr = await checkPrDiff(read, source);
	await checkOwnerConsent(read, source, pr);
	await checkMerge(read, source, go, context);
	await checkLiveGo(read, go, source);
}

function requireReview(review: ReviewContract, go: GoEvidence): void {
	if (
		review.environment !== "formbar-rc" ||
		!review.protectedMain ||
		!review.noBypass ||
		!review.protectedBranchesOnly ||
		!review.preventSelfReview ||
		!Number.isSafeInteger(review.runId) ||
		review.runId <= 0 ||
		review.approvedRunId !== review.runId ||
		review.runId !== go.runId ||
		review.runAttempt !== go.runAttempt ||
		review.runAttempt !== 1 ||
		review.reviewer === review.dispatcher ||
		review.dispatcher !== "eaglez" ||
		review.reviewer !== "spralle" ||
		go.signer !== "spralle" ||
		review.goSigner !== go.signer
	)
		throw new Error("Missing protected, independent per-run environment approval");
}

async function requireVersionSource(root: string): Promise<void> {
	const pre = JSON.parse(await readFile(join(root, ".changeset/pre.json"), "utf8"));
	checkPre(pre);
	for (const name of rcPackages) {
		const pkg = JSON.parse(await readFile(join(root, `packages/${name}/package.json`), "utf8"));
		checkManifest(name, pkg);
		checkChangelog(name, await readFile(join(root, `packages/${name}/CHANGELOG.md`), "utf8"));
	}
}

// Disabled read-only inspection; injected transport and evidence never grant publish authority.
export async function inspectRcSource(
	root: string,
	context: DispatchContext,
	plan: ReleasePlan,
	reader: ReleaseReader,
	source: ReviewedSource,
	go: GoEvidence,
	review: ReviewContract,
	live: ReadOnlyTransport,
): Promise<void> {
	requireReviewedSource(source);
	requireGo(go, source, context);
	requireReview(review, go);
	await inspectLiveReviewedSource(live, source, go, context);
	await checkRcCandidate(context, plan, reader);
	await requireVersionSource(root);
	await preflightAll(plan.candidates, reader);
}
