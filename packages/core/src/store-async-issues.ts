import { clearAttempt } from "./attempt-issues.js";
import { wasIssueEmission } from "./issue-provenance.js";
import type { ValidationIssue } from "./state.js";
import { type FormStore, publishIssueOnly, publishOwnedMetadata } from "./store.js";

/** Replaces only the selected async origins; issue-only ingress preserves certified originals. */
export function replaceOwnedAsyncIssues<TData, TUi>(
	store: FormStore<TData, TUi>,
	ids: ReadonlySet<string>,
	issues: readonly ValidationIssue[],
): void {
	publishIssueOnly(store, [
		...store
			.getState()
			.issues.filter(
				(issue) =>
					(issue.source.origin !== "async-validator" && !wasIssueEmission(issue)) || !ids.has(issue.source.validatorId),
			),
		...issues,
	]);
}

export function ownedAsyncIssuePublisher<TData, TUi>(store: FormStore<TData, TUi>) {
	return store.isOwnedSchedulingMode()
		? {
				replaceAsyncIssues: (ids: ReadonlySet<string>, issues: readonly ValidationIssue[]) =>
					replaceOwnedAsyncIssues(store, ids, issues),
			}
		: {};
}

export function clearRuntimeAttempt<TData, TUi>(store: FormStore<TData, TUi>): void {
	if (store.isOwnedSchedulingMode()) {
		publishOwnedMetadata(store, { kind: "clearAttempt" });
		return;
	}
	const tx = store.beginTransaction();
	tx.mutate(clearAttempt);
	store.commitTransaction(tx);
}
