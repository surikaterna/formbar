import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type DispatchContext, checkRcCandidate } from "./guard";
import { preflightAll } from "./preflight";
import {
	checkChangelog,
	checkManifest,
	checkPre,
	rcPackages,
	reviewedBase,
	reviewedHead,
	reviewedTree,
} from "./rc-reviewed-plan";
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
	acknowledgesLegacyIssueMigration: boolean;
	versions: string[];
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
		source.base !== reviewedBase ||
		source.head !== reviewedHead ||
		source.versionTree !== reviewedTree ||
		![source.base, source.head, source.versionTree, source.mainTree, source.reviewedMainTree].every((s) =>
			shaPattern.test(s),
		) ||
		source.base !== source.observedBase ||
		source.head !== source.observedHead ||
		source.versionTree !== source.observedVersionTree ||
		source.mainTree !== source.reviewedMainTree
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
		!go.acknowledgesLegacyIssueMigration ||
		go.distTag !== "rc" ||
		!go.provenance ||
		JSON.stringify(go.versions) !== JSON.stringify(rcPackages.map((name) => `@formbar/${name}@0.23.0-rc.0`))
	)
		throw new Error("Missing, edited, stale or mismatched #250 FINAL GO evidence");
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

// Offline evaluation of evidence supplied by an independent reader; never grants publish authority.
export async function inspectRcSource(
	root: string,
	context: DispatchContext,
	plan: ReleasePlan,
	reader: ReleaseReader,
	source: ReviewedSource,
	go: GoEvidence,
	review: ReviewContract,
): Promise<void> {
	requireReviewedSource(source);
	requireGo(go, source, context);
	requireReview(review, go);
	await checkRcCandidate(context, plan, reader);
	await requireVersionSource(root);
	await preflightAll(plan.candidates, reader);
}
