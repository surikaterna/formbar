import { beginAttempt, clearAttempt, completeAttempt } from "./attempt-issues.js";
import { type BoundAttemptReceipt, beginBoundAttempt } from "./bound-attempt-receipt.js";
import type { AsyncValidationResult, FormApi, Middleware, ValidatorFn } from "./contracts.js";
import { type FinalGeneration, beginFinalGeneration } from "./final-generation.js";
import { prepareGuardedSubmitCandidate } from "./guarded-submit-candidate.js";
import { ownIssues } from "./issue-ownership.js";
import { normalizeValidators } from "./normalize-validators.js";
import type { PipelineContext } from "./pipeline.js";
import { runScopedSync, runUnscopedFinal, scopedSyncGeneration } from "./scoped-sync.js";
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
	| {
			readonly ok: true;
			readonly issues: readonly ValidationIssue[];
			readonly checked?: Extract<ReturnType<typeof prepareGuardedSubmitCandidate>, { ok: true }>;
			readonly receipt?: BoundAttemptReceipt;
	  }
	| { readonly ok: false; readonly code: "validation_failed"; readonly fieldIssues: readonly ValidationIssue[] }
	| { readonly ok: false; readonly code: "stale" | "vetoed" | "unsafe_candidate" | "invalid_witness" | "aborted" };

interface CandidateValidationContext {
	readonly stage: string | undefined;
	readonly submitContext: SubmitContext | undefined;
	readonly current: () => boolean;
	readonly state: FormState<unknown, unknown>;
}

interface CandidateSyncResult {
	readonly sync: readonly ValidationIssue[];
	readonly capture: FormStateCapture<unknown, unknown> | undefined;
}

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
	finalGeneration?: FinalGeneration,
	generationKey?: object,
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
				...(finalGeneration ? { finalGeneration } : {}),
			})
		: [];
	if (!form && finalGeneration && generationKey) runUnscopedFinal(generationKey, finalGeneration);
	if (!current()) return;
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
	finalGeneration?: FinalGeneration,
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
			...(finalGeneration ? { finalGeneration } : {}),
		});
	} catch (error) {
		if (error instanceof Error && error.message === "ISSUE_ONLY_UNSUPPORTED_STATE") {
			clearPublication(context, submitId);
			return { ok: false, code: "unsafe_candidate" };
		}
		asyncResult = { status: "aborted", issues: [] };
	}
	if (!current() || asyncResult.status !== "completed" || (finalGeneration && !finalGeneration.current())) {
		clearPublication(context, submitId);
		return { ok: false, code: asyncResult.status === "aborted" ? "aborted" : "stale" };
	}
	if (current())
		publish(context, { kind: "completeAttempt", submitId, revision, result: asyncResult, syncIssues: sync }, (draft) =>
			completeAttempt(draft, submitId, revision, asyncResult, sync),
		);
	if (finalGeneration && !finalGeneration.current()) {
		clearPublication(context, submitId);
		return { ok: false, code: "stale" };
	}
	return completedAttemptOutcome(context, submitId, current);
}

function completedAttemptOutcome(context: PipelineContext, submitId: string, current: () => boolean): Outcome {
	const attempt = context.store.getState().attemptValidation;
	if (!current() || attempt?.submitId !== submitId || attempt.status === "running") {
		clearPublication(context, submitId);
		return { ok: false, code: "stale" };
	}
	return attempt.status === "failed"
		? { ok: false, code: "validation_failed", fieldIssues: attempt.issues }
		: { ok: true, issues: attempt.issues };
}

function candidateValidationContext(
	context: PipelineContext,
	guard: SubmitPreparationGuard,
	coordinator: ValidationCoordinator<unknown, unknown>,
	data: unknown,
	uiState: unknown,
	revision: number,
): CandidateValidationContext | undefined {
	const retained = context.store.getState();
	const retainedBaseline = freeze(clone({ data: retained.data, uiState: retained.uiState }).value);
	const stage = retained.meta.stage;
	let submitContext: SubmitContext | undefined;
	try {
		if (context.submitContext) submitContext = freeze(clone(context.submitContext).value) as unknown as SubmitContext;
	} catch {
		return;
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
	return { stage, submitContext, current, state };
}

function candidateSyncResult(
	context: PipelineContext,
	form: FormApi<unknown, unknown> | undefined,
	snapshot: { readonly data: unknown; readonly uiState: unknown },
	stage: string | undefined,
	submitContext: SubmitContext | undefined,
	signal: AbortSignal,
	current: () => boolean,
	finalGeneration?: FinalGeneration,
	preparedCapture?: FormStateCapture<unknown, unknown>,
): CandidateSyncResult | undefined {
	try {
		const validators = normalizeValidators(context.options);
		const capture = preparedCapture ?? form?.captureState();
		const sync = syncCandidateIssues(
			form,
			validators,
			snapshot,
			stage,
			submitContext,
			signal,
			current,
			capture,
			finalGeneration,
			form ?? context.store,
		);
		return sync ? { sync, capture } : undefined;
	} catch {
		return;
	}
}

async function finishGuardedValidation(
	context: PipelineContext,
	guard: SubmitPreparationGuard,
	coordinator: ValidationCoordinator<unknown, unknown>,
	submitId: string,
	prepared: Extract<ReturnType<typeof prepareGuardedSubmitCandidate>, { ok: true }>,
	preparedContext: CandidateValidationContext,
	syncResult: CandidateSyncResult,
	finalGeneration: FinalGeneration,
): Promise<Outcome> {
	const { data, uiState } = prepared.candidate;
	const { stage, submitContext, current, state } = preparedContext;
	const middleware = (context.options.middleware ?? []) as readonly Middleware[];
	if (!notify(middleware, "afterValidate", context.action, state, syncResult.sync, current))
		return { ok: false, code: "stale" };
	if (!finalGeneration.syncCurrent()) return { ok: false, code: "stale" };
	return completeValidation(
		context,
		guard,
		coordinator,
		submitId,
		prepared.revision,
		data,
		uiState,
		stage,
		submitContext,
		current,
		syncResult.sync,
		syncResult.capture,
		finalGeneration,
	);
}

function finalCandidateGeneration(
	key: object,
	coordinator: ValidationCoordinator<unknown, unknown>,
	current: () => boolean,
): FinalGeneration {
	return beginFinalGeneration(() => scopedSyncGeneration(key), coordinator.foregroundRevision, current);
}

/** Internal C1 only: never evaluates retained-issue eligibility or calls a submit handler. */
export async function validateGuardedSubmitCandidate(
	context: PipelineContext,
	guard: SubmitPreparationGuard,
	adapter: SubmitDefinitionAdapter | undefined,
	coordinator: ValidationCoordinator<unknown, unknown>,
	submitId: string,
	transforms: readonly CandidateEgress[] = [],
	form?: FormApi<unknown, unknown>,
	boundForm?: FormApi<unknown, unknown>,
): Promise<Outcome> {
	if (boundForm && form && boundForm !== form) return { ok: false, code: "invalid_witness" };
	const preflight = boundForm ? beginBoundAttempt(boundForm) : undefined;
	const generationKey = boundForm ?? form ?? context.store;
	// Snapshot both generation lanes before preparation can invoke caller hooks or egress.
	const finalGeneration = finalCandidateGeneration(
		generationKey,
		coordinator,
		() => preparedContext?.current() ?? false,
	);
	const prepared = prepareGuardedSubmitCandidate(context, guard, adapter, transforms, boundForm, preflight);
	if (!prepared.ok) return prepared;
	const { data, uiState } = prepared.candidate;
	const revision = prepared.revision;
	const preparedContext = candidateValidationContext(context, guard, coordinator, data, uiState, revision);
	if (!preparedContext) return { ok: false, code: "unsafe_candidate" };
	const { stage, submitContext, current, state } = preparedContext;
	const finishReceipt =
		preflight && prepared.capture && prepared.candidate.plan
			? preflight.checked(prepared.capture, prepared.candidate.plan, submitId, revision, current)
			: undefined;
	const middleware = (context.options.middleware ?? []) as readonly Middleware[];
	if (!current() || !notify(middleware, "beforeValidate", context.action, state, [], current))
		return { ok: false, code: "stale" };
	const syncResult = candidateSyncResult(
		context,
		boundForm ?? form,
		{ data, uiState },
		stage,
		submitContext,
		guard.signal,
		current,
		finalGeneration,
		prepared.capture,
	);
	if (!syncResult || !current()) return { ok: false, code: "unsafe_candidate" };
	if (!finalGeneration.syncCurrent()) return { ok: false, code: "stale" };
	const outcome = await finishGuardedValidation(
		context,
		guard,
		coordinator,
		submitId,
		prepared,
		preparedContext,
		syncResult,
		finalGeneration,
	);
	if (!outcome.ok || !boundForm) return outcome;
	const receipt = finishReceipt?.(finalGeneration);
	return Object.freeze({ ...outcome, checked: prepared, ...(receipt ? { receipt } : {}) });
}
