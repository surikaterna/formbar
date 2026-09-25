import { issueEmissionId } from "./issue-provenance.js";
import type { CanonicalSegment } from "./path.js";
import type { ValidationIssue } from "./state.js";

function comparePaths(a: readonly CanonicalSegment[], b: readonly CanonicalSegment[]): number {
	const len = Math.min(a.length, b.length);
	for (let i = 0; i < len; i++) {
		const sa = String(a[i]);
		const sb = String(b[i]);
		if (sa < sb) return -1;
		if (sa > sb) return 1;
	}
	return a.length - b.length;
}

/** ADR 6.3 — deterministic 7-key sort for validation issues. */
export function sortIssues(
	issues: readonly ValidationIssue[],
	orderedStages?: readonly string[],
): readonly ValidationIssue[] {
	const stageOrder = orderedStages ? new Map(orderedStages.map((s, i) => [s, i])) : undefined;
	const severityOrder: Record<string, number> = { error: 0, warning: 1, info: 2 };
	const nsOrder: Record<string, number> = { data: 0, ui: 1 };

	return [...issues].sort((a, b) => {
		if (stageOrder) {
			const sa = stageOrder.get(a.stage ?? "") ?? Number.POSITIVE_INFINITY;
			const sb = stageOrder.get(b.stage ?? "") ?? Number.POSITIVE_INFINITY;
			if (sa !== sb) return sa - sb;
		}

		const sevA = severityOrder[a.severity] ?? 3;
		const sevB = severityOrder[b.severity] ?? 3;
		if (sevA !== sevB) return sevA - sevB;

		const nsA = nsOrder[a.path.namespace] ?? 2;
		const nsB = nsOrder[b.path.namespace] ?? 2;
		if (nsA !== nsB) return nsA - nsB;

		const pathCmp = comparePaths(a.path.segments, b.path.segments);
		if (pathCmp !== 0) return pathCmp;

		if (a.code < b.code) return -1;
		if (a.code > b.code) return 1;

		if (a.source.validatorId < b.source.validatorId) return -1;
		if (a.source.validatorId > b.source.validatorId) return 1;

		if (a.message < b.message) return -1;
		if (a.message > b.message) return 1;

		return 0;
	});
}

function buildDedupeKey(issue: ValidationIssue): string {
	const pathStr = `${issue.path.namespace}:${issue.path.segments.join(".")}`;
	return `${issue.stage ?? ""}|${issue.severity}|${pathStr}|${issue.code}|${issue.source.origin}|${issue.source.validatorId}|${issue.message}`;
}

/** ADR 6.3 — deduplicate validation issues by composite key. */
export function dedupeIssues(issues: readonly ValidationIssue[]): readonly ValidationIssue[] {
	const seen = new Set<string>();
	return issues.filter((issue) => {
		const emission = issueEmissionId(issue);
		const key = emission === undefined ? buildDedupeKey(issue) : `emission:${emission}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/** ADR 6.3 — deduplicate then sort issues into deterministic order. */
export function normalizeIssues(
	issues: readonly ValidationIssue[],
	orderedStages?: readonly string[],
): readonly ValidationIssue[] {
	return sortIssues(dedupeIssues(issues), orderedStages);
}
