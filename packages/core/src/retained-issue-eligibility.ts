import { type BoundAttemptReceipt, receiptCoversRetainedIssue } from "./bound-attempt-receipt.js";
import type { FormState } from "./state.js";

/** Private post-FINAL gate; a checked receipt exempts only its exact original retained issues. */
export function boundAttemptCanSubmit<TData, TUi>(
	state: FormState<TData, TUi>,
	revision: number,
	receipt: BoundAttemptReceipt | undefined,
): boolean {
	const attempt = state.attemptValidation;
	if (!attempt || attempt.revision !== revision || attempt.status !== "succeeded") return false;
	if (state.meta.submission?.status === "running" || state.meta.validation.validating) return false;
	if (attempt.issues.some((issue) => issue.severity === "error")) return false;
	return !state.issues.some(
		(issue) =>
			issue.severity === "error" && !receiptCoversRetainedIssue(receipt, state as FormState<unknown, unknown>, issue),
	);
}
