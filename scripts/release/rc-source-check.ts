import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type DispatchContext, checkRcCandidate } from "./guard";
import { preflightAll } from "./preflight";
import type { ReleasePlan, ReleaseReader } from "./types";

const names = ["arbiter", "core", "declarative", "from-schema", "react", "react-schema"];
const shaPattern = /^[0-9a-f]{40}$/;
const auditedBase = "ed949ab79f34cea6c205969b0d3e6bd038060721";
const auditedHead = "403995aefdb6ae8faaf990eef95f32c03b2debce";
export const consumed = [
	"bound-noop-witness",
	"certified-object-descendants",
	"checked-bound-handler",
	"final-owned-generation",
	"final-retained-attempt-gate",
	"original-bound-attempt-receipt",
	"owned-disposal-settlement",
	"owned-scheduling-boundary",
	"owned-semantic-epoch",
	"public-bound-omission",
	"react-omission-attempt-ui",
	"real-bound-guarded-bridge",
	"real-bound-omission-supplier",
	"scoped-async-core",
	"scoped-async-declarative",
	"scoped-async-from-schema",
	"scoped-async-react-schema",
	"scoped-final-async",
	"scoped-ownership-receipt",
	"scoped-validation-public-types",
	"unified-issue-ownership",
	"validated-hidden-submission-policy",
];

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
		source.base !== auditedBase ||
		source.head !== auditedHead ||
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
		go.versions.length !== 6 ||
		names.some((name) => !go.versions.includes(`@formbar/${name}@0.23.0-rc.0`))
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
	if (
		pre.mode !== "pre" ||
		pre.tag !== "rc" ||
		!Array.isArray(pre.changesets) ||
		JSON.stringify([...pre.changesets].sort()) !== JSON.stringify(consumed) ||
		pre.initialVersions?.["@formbar/expressions"] !== "0.14.3"
	)
		throw new Error("Unexpected Changesets prerelease state or consumed IDs");
	for (const name of [...names, "expressions"]) {
		const pkg = JSON.parse(await readFile(join(root, `packages/${name}/package.json`), "utf8"));
		const version = name === "expressions" ? "0.14.3" : "0.23.0-rc.0";
		if (pkg.name !== `@formbar/${name}` || pkg.version !== version) throw new Error(`Unexpected ${name} version`);
		for (const [dependency, range] of Object.entries(pkg.dependencies ?? {})) {
			if (
				dependency.startsWith("@formbar/") &&
				range !== (dependency === "@formbar/expressions" ? "^0.14.3" : "^0.23.0-rc.0")
			)
				throw new Error(`Unexpected prerelease dependency ${name} -> ${dependency}`);
		}
		if (name !== "expressions") {
			const log = await readFile(join(root, `packages/${name}/CHANGELOG.md`), "utf8");
			if (!log.includes("## 0.23.0-rc.0")) throw new Error(`Missing ${name} rc changelog`);
		}
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
