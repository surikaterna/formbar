import { beginAttempt, clearAttempt, completeAttempt } from "./attempt-issues.js";
import type { AsyncValidationResult, FormApi, Middleware, ValidatorFn } from "./contracts.js";
import { prepareGuardedSubmitCandidate } from "./guarded-submit-candidate.js";
import { ownIssues } from "./issue-ownership.js";
import { normalizeValidators } from "./normalize-validators.js";
import type { PipelineContext } from "./pipeline.js";
import { runScopedSync } from "./scoped-sync.js";
import type { FormState, FormStateCapture, SubmitContext, ValidationIssue } from "./state.js";
import type { OwnedMetadata } from "./store-metadata.js";
import { publishOwnedMetadata } from "./store.js";
import type { SubmitDefinitionAdapter } from "./submit-adapter-contract.js";
import { clone, freeze, unchanged } from "./submit-candidate-safety.js";
import type { CandidateEgress } from "./submit-candidate-safety.js";
import type { SubmitPreparationGuard } from "./submit-preparation-checkpoint.js";
import type { ValidationCoordinator } from "./validation-coordinator.js";
import { normalizeIssues } from "./validation.js";

type Outcome =
	| { readonly ok: true; readonly issues: readonly ValidationIssue[] }
	| { readonly ok: false; readonly code: "validation_failed"; readonly fieldIssues: readonly ValidationIssue[] }
	| { readonly ok: false; readonly code: "stale" | "vetoed" | "unsafe_candidate" | "invalid_witness" | "aborted" };

function publish(
	context: PipelineContext,
	change: OwnedMetadata,
	update: (state: FormState<unknown, unknown>) => FormState<unknown, unknown>,
) {
	if (context.store.isOwnedSchedulingMode()) {
		publishOwnedMetadata(context.store, change);
		return;
	}
	const tx = context.store.beginTransaction();
	tx.mutate(update);
	context.store.commitTransaction(tx);
}

function clearPublication(context: PipelineContext, submitId: string): void {
	publish(context, { kind: "clearAttempt", submitId }, (draft) =>
		draft.attemptValidation?.submitId === submitId ? clearAttempt(draft) : draft,
	);
}

function rejectSyncReturn(result: unknown): boolean {
	if (result === null || (typeof result !== "object" && typeof result !== "function")) return result !== undefined;
	// Observe a rejected async return even though this path must reject it synchronously.
	Promise.resolve(result).then(undefined, () => {});
	return true;
}

function notify(
	middleware: readonly Middleware[],
	hook: "beforeValidate" | "afterValidate",
	action: PipelineContext["action"],
	state: FormState<unknown, unknown>,
	issues: readonly ValidationIssue[],
	current: () => boolean,
): boolean {
	for (const entry of middleware) {
		if (!current()) return false;
		try {
			const result: unknown =
				hook === "beforeValidate"
					? entry.beforeValidate?.({
							action,
							state,
							...(state.meta.stage ? { stage: state.meta.stage } : {}),
						})
					: entry.afterValidate?.({
							action,
							state,
							issues: freeze(clone(issues).value) as unknown as readonly ValidationIssue[],
						});
			if (rejectSyncReturn(result)) return false;
		} catch {
			return false;
		}
		if (!current()) return false;
	}
	return true;
}

function syncValidation(
	validators: readonly ValidatorFn[],
	data: unknown,
	uiState: unknown,
	stage: string | undefined,
	context: PipelineContext["submitContext"],
	current: () => boolean,
): readonly ValidationIssue[] | undefined {
	const issues: ValidationIssue[] = [];
	for (const validator of validators) {
		if (!current()) return;
		try {
			const result = validator({
				data,
				uiState,
				...(stage === undefined ? {} : { stage }),
				...(context ? { context } : {}),
			});
			if (!Array.isArray(result)) {
				rejectSyncReturn(result);
				return;
			}
			issues.push(...result);
		} catch {
			return;
		}
		if (!current()) return;
	}
	return normalizeIssues(ownIssues(issues));
}

function syncCandidateIssues(
	form: FormApi<unknown, unknown> | undefined,
	validators: readonly ValidatorFn[],
	snapshot: { readonly data: unknown; readonly uiState: unknown },
	stage: string | undefined,
	context: SubmitContext | undefined,
	signal: AbortSignal,
	current: () => boolean,
	capture?: FormStateCapture<unknown, unknown>,
): readonly ValidationIssue[] | undefined {
	const legacy = syncValidation(validators, snapshot.data, snapshot.uiState, stage, context, current);
	if (!legacy || !current()) return;
	const scoped = form
		? runScopedSync(form, stage, {
				snapshot,
				...(context ? { context } : {}),
				signal,
				current,
				...(capture ? { capture } : {}),
			})
		: [];
	return normalizeIssues(ownIssues([...legacy, ...scoped]));
}

function ownedValidationState(data: unknown, uiState: unknown, stage: string | undefined): FormState<unknown, unknown> {
	return Object.freeze({
		data,
		uiState,
		meta: Object.freeze({ validation: Object.freeze({}), ...(stage === undefined ? {} : { stage }) }),
		fieldMeta: Object.freeze({}),
		fieldPolicy: Object.freeze([]),
		issues: Object.freeze([]),
	});
}

async function completeValidation(
	context: PipelineContext,
	guard: SubmitPreparationGuard,
	coordinator: ValidationCoordinator<unknown, unknown>,
	submitId: string,
	revision: number,
	data: unknown,
	uiState: unknown,
	stage: string | undefined,
	submitContext: SubmitContext | undefined,
	current: () => boolean,
	sync: readonly ValidationIssue[],
	capture?: FormStateCapture<unknown, unknown>,
): Promise<Outcome> {
	publish(context, { kind: "beginAttempt", submitId, revision }, (draft) => beginAttempt(draft, submitId, revision));
	if (!current() || context.store.getState().attemptValidation?.submitId !== submitId) {
		clearPublication(context, submitId);
		return { ok: false, code: "stale" };
	}
	let asyncResult: AsyncValidationResult;
	try {
		asyncResult = await coordinator.validateCandidate({ data, uiState }, revision, guard.signal, {
			...(stage === undefined ? {} : { stage }),
			...(submitContext ? { context: submitContext } : {}),
			...(capture ? { capture } : {}),
		});
	} catch (error) {
		if (error instanceof Error && error.message === "ISSUE_ONLY_UNSUPPORTED_STATE") {
			clearPublication(context, submitId);
			return { ok: false, code: "unsafe_candidate" };
		}
		asyncResult = { status: "aborted", issues: [] };
	}
	if (!current() || asyncResult.status !== "completed") {
		clearPublication(context, submitId);
		return { ok: false, code: asyncResult.status === "aborted" ? "aborted" : "stale" };
	}
	if (current())
		publish(context, { kind: "completeAttempt", submitId, revision, result: asyncResult, syncIssues: sync }, (draft) =>
			completeAttempt(draft, submitId, revision, asyncResult, sync),
		);
	const attempt = context.store.getState().attemptValidation;
	if (!current() || attempt?.submitId !== submitId || attempt.status === "running") {
		clearPublication(context, submitId);
		return { ok: false, code: "stale" };
	}
	return attempt.status === "failed"
		? { ok: false, code: "validation_failed", fieldIssues: attempt.issues }
		: { ok: true, issues: attempt.issues };
}

/** Internal C1 only: never evaluates retained-issue eligibility or calls a submit handler. */
export async function validateGuardedSubmitCandidate(
	context: PipelineContext,
	guard: SubmitPreparationGuard,
	adapter: SubmitDefinitionAdapter,
	coordinator: ValidationCoordinator<unknown, unknown>,
	submitId: string,
	transforms: readonly CandidateEgress[] = [],
	form?: FormApi<unknown, unknown>,
): Promise<Outcome> {
	const prepared = prepareGuardedSubmitCandidate(context, guard, adapter, transforms);
	if (!prepared.ok) return prepared;
	const { data, uiState } = prepared.candidate;
	const revision = prepared.revision;
	const retained = context.store.getState();
	const retainedBaseline = freeze(clone({ data: retained.data, uiState: retained.uiState }).value);
	const stage = retained.meta.stage;
	let submitContext: SubmitContext | undefined;
	try {
		if (context.submitContext) submitContext = freeze(clone(context.submitContext).value) as unknown as SubmitContext;
	} catch {
		return { ok: false, code: "unsafe_candidate" };
	}
	const state = ownedValidationState(data, uiState, stage);
	const baseline = freeze(clone({ data, uiState }).value);
	const current = () =>
		!guard.signal.aborted &&
		guard.isActive?.() !== false &&
		guard.revision() === revision &&
		coordinator.revision() === revision &&
		unchanged({ data: context.store.getState().data, uiState: context.store.getState().uiState }, retainedBaseline) &&
		unchanged({ data, uiState }, baseline);
	const middleware = (context.options.middleware ?? []) as readonly Middleware[];
	if (!current() || !notify(middleware, "beforeValidate", context.action, state, [], current))
		return { ok: false, code: "stale" };
	let validators: readonly ValidatorFn[];
	try {
		validators = normalizeValidators(context.options);
	} catch {
		return { ok: false, code: "unsafe_candidate" };
	}
	let sync: readonly ValidationIssue[] | undefined;
	let capture: FormStateCapture<unknown, unknown> | undefined;
	try {
		capture = form?.captureState();
		sync = syncCandidateIssues(
			form,
			validators,
			{ data, uiState },
			stage,
			submitContext,
			guard.signal,
			current,
			capture,
		);
	} catch {
		return { ok: false, code: "unsafe_candidate" };
	}
	if (!sync || !current()) return { ok: false, code: "unsafe_candidate" };
	if (!notify(middleware, "afterValidate", context.action, state, sync, current)) return { ok: false, code: "stale" };
	if (!current()) return { ok: false, code: "stale" };
	return completeValidation(
		context,
		guard,
		coordinator,
		submitId,
		revision,
		data,
		uiState,
		stage,
		submitContext,
		current,
		sync,
		capture,
	);
}
