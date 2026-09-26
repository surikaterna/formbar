import { rejectAttempt } from "./attempt-issues.js";
import type { BoundAttemptReceipt } from "./bound-attempt-receipt.js";
import type { PipelineContext } from "./pipeline.js";
import { boundAttemptCanSubmit } from "./retained-issue-eligibility.js";
import type { ValidationIssue } from "./state.js";
import { publishOwnedMetadata } from "./store.js";

/** A retained blocker fails the same attempt lane; candidate validator issues remain untouched. */
export function rejectBlockedBoundAttempt(
	context: PipelineContext,
	submitId: string,
	revision: number,
	receipt: BoundAttemptReceipt | undefined,
): readonly ValidationIssue[] | undefined {
	const state = context.store.getState();
	if (boundAttemptCanSubmit(state, revision, receipt, submitId)) return;
	const blockers = state.issues.filter((issue) => issue.severity === "error" && !receipt?.covers(issue));
	if (context.store.isOwnedSchedulingMode()) {
		publishOwnedMetadata(context.store, { kind: "rejectAttempt", submitId, revision });
	} else {
		const tx = context.store.beginTransaction();
		tx.mutate((draft) => rejectAttempt(draft, submitId, revision));
		context.store.commitTransaction(tx);
	}
	return blockers;
}
