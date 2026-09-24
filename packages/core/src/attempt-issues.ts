import type { AsyncValidationResult } from "./contracts.js";
import type { AttemptValidation, FormState, ValidationIssue } from "./state.js";
import { normalizeIssues } from "./validation.js";

/** Render retained diagnostics alongside the latest failed candidate, without cross-lane deduplication. */
export function renderableIssues<TData, TUi>(state: FormState<TData, TUi>): readonly ValidationIssue[] {
	const attempt = state.attemptValidation;
	if (attempt?.status !== "failed") return state.issues;
	return [...state.issues, ...normalizeIssues(attempt.issues)];
}

/** An unverified candidate is never eligible; retained non-validator errors remain blocking. */
export function attemptCanSubmit<TData, TUi>(state: FormState<TData, TUi>, revision: number): boolean {
	const attempt = state.attemptValidation;
	if (!attempt || attempt.revision !== revision || attempt.status !== "succeeded") return false;
	if (state.meta.submission?.status === "running" || state.meta.validation.validating) return false;
	return !state.issues.some((issue) => issue.severity === "error" && !isDraftValidatorOrigin(issue.source.origin));
}

function isDraftValidatorOrigin(origin: ValidationIssue["source"]["origin"]): boolean {
	return (
		origin === "standard-schema" ||
		origin === "function-validator" ||
		origin === "json-schema-adapter" ||
		origin === "async-validator"
	);
}

/** Internal state transitions for the future opt-in submit pipeline. IDs and revisions guard late results. */
export function beginAttempt<TData, TUi>(
	state: FormState<TData, TUi>,
	submitId: string,
	revision: number,
): FormState<TData, TUi> {
	return { ...state, attemptValidation: { submitId, revision, status: "running", issues: [] } };
}

export function completeAttempt<TData, TUi>(
	state: FormState<TData, TUi>,
	submitId: string,
	revision: number,
	result: AsyncValidationResult,
	syncIssues: readonly ValidationIssue[] = [],
): FormState<TData, TUi> {
	const attempt = state.attemptValidation;
	if (attempt?.submitId !== submitId || attempt.revision !== revision || attempt.status !== "running") return state;
	if (result.status !== "completed") return { ...state, attemptValidation: undefined };
	const issues = normalizeIssues([...syncIssues, ...result.issues]);
	return {
		...state,
		attemptValidation: {
			submitId,
			revision,
			status: issues.some((issue) => issue.severity === "error") ? "failed" : "succeeded",
			issues,
		},
	};
}

export function clearAttempt<TData, TUi>(state: FormState<TData, TUi>): FormState<TData, TUi> {
	return state.attemptValidation ? { ...state, attemptValidation: undefined } : state;
}
