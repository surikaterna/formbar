import { beginAttempt, clearAttempt, completeAttempt, rebaseAttemptIssues } from "./attempt-issues.js";
import type { AsyncValidationResult } from "./contracts.js";
import { ownIssues } from "./issue-ownership.js";
import type { FieldMetaEntry, FormState, ValidationIssue } from "./state.js";
import { applySubmitOutcome } from "./submit.js";

/** No caller-supplied state updater is admitted to the semantic-write bypass. */
export type OwnedMetadata =
	| { readonly kind: "fieldMeta"; readonly entries: Readonly<Record<string, FieldMetaEntry>> }
	| { readonly kind: "clearAttempt"; readonly submitId?: string }
	| { readonly kind: "beginAttempt"; readonly submitId: string; readonly revision: number }
	| {
			readonly kind: "completeAttempt";
			readonly submitId: string;
			readonly revision: number;
			readonly result: AsyncValidationResult;
			readonly syncIssues: readonly ValidationIssue[];
	  }
	| { readonly kind: "submitRunning"; readonly submitId: string; readonly at: string }
	| {
			readonly kind: "submitOutcome";
			readonly ok: boolean;
			readonly submitId: string;
			readonly issues: readonly ValidationIssue[];
	  }
	| { readonly kind: "appendIssues"; readonly issues: readonly ValidationIssue[] };

function ownAttempt<TData, TUi>(state: FormState<TData, TUi>): FormState<TData, TUi> {
	const attempt = state.attemptValidation;
	if (!attempt) return state;
	const issues = ownIssues(attempt.issues);
	const renderableIssues = Object.freeze(
		attempt.status === "failed" ? [...state.issues, ...issues] : [...state.issues],
	);
	return {
		...state,
		attemptValidation: Object.freeze({ ...attempt, issues, renderableIssues }),
	};
}

function ownedFieldMeta(entries: Readonly<Record<string, FieldMetaEntry>>): Readonly<Record<string, FieldMetaEntry>> {
	return Object.freeze(
		Object.fromEntries(
			Object.entries(entries).map(([key, entry]) => [
				key,
				Object.freeze({
					touched: entry.touched,
					dirty: entry.dirty,
					listenerTriggered: entry.listenerTriggered,
					isValidating: entry.isValidating,
				}),
			]),
		),
	);
}

function nextMetadataState<TData, TUi>(state: FormState<TData, TUi>, change: OwnedMetadata): FormState<TData, TUi> {
	let next: FormState<TData, TUi>;
	switch (change.kind) {
		case "fieldMeta": {
			next = { ...state, fieldMeta: ownedFieldMeta(change.entries) };
			break;
		}
		case "clearAttempt":
			next = change.submitId && state.attemptValidation?.submitId !== change.submitId ? state : clearAttempt(state);
			break;
		case "beginAttempt":
			next = beginAttempt(state, change.submitId, change.revision);
			break;
		case "completeAttempt":
			next = completeAttempt(state, change.submitId, change.revision, change.result, change.syncIssues);
			break;
		case "submitRunning":
			next = {
				...state,
				meta: {
					...state.meta,
					submitted: true,
					submission: { status: "running", submitId: change.submitId, lastAttemptAt: change.at },
				},
			};
			break;
		case "submitOutcome":
			next = {
				...state,
				meta: applySubmitOutcome(state.meta, change.ok, change.submitId),
				issues: Object.freeze([...state.issues, ...ownIssues(change.issues)]),
			};
			break;
		case "appendIssues":
			next = { ...state, issues: Object.freeze([...state.issues, ...ownIssues(change.issues)]) };
	}
	return next;
}

export function applyOwnedMetadata<TData, TUi>(
	state: FormState<TData, TUi>,
	change: OwnedMetadata,
): FormState<TData, TUi> {
	const next = nextMetadataState(state, change);
	if (next === state) return state;
	const withIssues = rebaseAttemptIssues(next);
	const attempt = ownAttempt(withIssues);
	return Object.freeze({
		...attempt,
		meta: Object.freeze({
			...attempt.meta,
			validation: Object.freeze({ ...attempt.meta.validation }),
			...(attempt.meta.submission ? { submission: Object.freeze(attempt.meta.submission) } : {}),
		}),
	});
}
