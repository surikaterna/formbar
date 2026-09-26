import type { beginBoundAttempt } from "./bound-attempt-receipt.js";
import { boundSubmitStore, boundSubmitSupplier } from "./bound-submit-supplier.js";
import type { FormApi } from "./contracts.js";
import type { PipelineContext } from "./pipeline.js";
import { executeSubmitPreparation } from "./pipeline.js";
import type { FormState, FormStateCapture } from "./state.js";
import type { SubmitDefinitionAdapter } from "./submit-adapter-contract.js";
import { Boundary, unchanged } from "./submit-candidate-safety.js";
import type { CandidateEgress } from "./submit-candidate-safety.js";
import { prepareOwnedSubmitAdapter } from "./submit-owned-adapter.js";
import type { SubmitPreparationGuard } from "./submit-preparation-checkpoint.js";

type Candidate = ReturnType<typeof prepareOwnedSubmitAdapter>;
type Preparation =
	| {
			readonly ok: true;
			readonly revision: number;
			readonly candidate: Extract<Candidate, { ok: true }>;
			readonly capture?: FormStateCapture<unknown, unknown>;
	  }
	| { readonly ok: false; readonly code: "stale" | "vetoed" | "unsafe_candidate" | "invalid_witness" };
type GateFailure = "stale" | "vetoed" | "unsafe_candidate";

function retainedGateCheck(snapshot: FormState<unknown, unknown>, current: () => boolean) {
	const boundary = new Boundary();
	const data = boundary.copy(snapshot.data);
	const uiState = boundary.copy(snapshot.uiState);
	return (): GateFailure | undefined => {
		if (!current()) return "stale";
		try {
			if (!unchanged(snapshot.data, data) || !unchanged(snapshot.uiState, uiState)) return "unsafe_candidate";
		} catch {
			return "unsafe_candidate";
		}
	};
}

function pluginGates(
	context: PipelineContext,
	snapshot: FormState<unknown, unknown>,
	check: () => GateFailure | undefined,
): GateFailure | undefined {
	for (const plugin of context.plugins ?? []) {
		const before = check();
		if (before) return before;
		try {
			const issues = plugin.beforeSubmit?.({
				data: snapshot.data as Readonly<unknown>,
				uiState: snapshot.uiState as Readonly<unknown>,
			});
			const after = check();
			if (after) return after;
			if (
				issues &&
				(typeof issues !== "object" || typeof (issues as unknown as Promise<unknown>).then === "function")
			) {
				void Promise.resolve(issues).then(
					() => undefined,
					() => undefined,
				);
				return "vetoed";
			}
			if (issues?.some((issue) => issue.severity === "error")) return "vetoed";
		} catch {
			return check() ?? "vetoed";
		}
	}
}

function selectBoundAdapter(
	form: FormApi<unknown, unknown>,
	context: PipelineContext,
	snapshot: FormState<unknown, unknown>,
	guard: SubmitPreparationGuard,
	check: () => GateFailure | undefined,
):
	| {
			readonly ok: true;
			readonly capture: FormStateCapture<unknown, unknown>;
			readonly adapter: SubmitDefinitionAdapter;
	  }
	| { readonly ok: false; readonly code: GateFailure | "invalid_witness" } {
	const supplier = boundSubmitSupplier(form);
	if (!supplier || boundSubmitStore(form) !== context.store) return { ok: false, code: "invalid_witness" };
	try {
		const capture = form.captureState();
		const failure = check();
		if (failure) return { ok: false, code: failure };
		if (capture.state !== snapshot || form.getState() !== snapshot) return { ok: false, code: "stale" };
		return {
			ok: true,
			capture,
			adapter: () => {
				const result = supplier(capture, guard.signal);
				if (
					!result ||
					(result.witness.kind !== "no-omission" &&
						(result.witness.kind !== "omission" || result.witness.omitted.length === 0))
				)
					throw new Error("unowned omission");
				return result;
			},
		};
	} catch {
		return { ok: false, code: "unsafe_candidate" };
	}
}

function currentGuardedState(
	context: PipelineContext,
	guard: SubmitPreparationGuard,
	revision: number,
	snapshot: FormState<unknown, unknown>,
): boolean {
	return (
		!guard.signal.aborted &&
		guard.isActive?.() !== false &&
		guard.revision() === revision &&
		context.store.getState() === snapshot
	);
}

/** Internal B handoff only: C/D own validation, handler and public activation. */
export function prepareGuardedSubmitCandidate(
	context: PipelineContext,
	guard: SubmitPreparationGuard,
	adapter: SubmitDefinitionAdapter | undefined,
	transforms: readonly CandidateEgress[] = [],
	boundForm?: FormApi<unknown, unknown>,
	preflight?: NonNullable<ReturnType<typeof beginBoundAttempt>>,
): Preparation {
	const prepared = executeSubmitPreparation(context, guard);
	if (prepared.stage === "rejected") return { ok: false, code: "vetoed" };
	const { snapshot, revision } = prepared;
	const current = () => currentGuardedState(context, guard, revision, snapshot);
	if (!current()) return { ok: false, code: "stale" };
	let check: () => GateFailure | undefined;
	try {
		check = retainedGateCheck(snapshot, current);
	} catch {
		return { ok: false, code: current() ? "unsafe_candidate" : "stale" };
	}
	const gate = pluginGates(context, snapshot, check);
	if (gate) return { ok: false, code: gate };
	const beforeCapture = check();
	if (beforeCapture) return { ok: false, code: beforeCapture };
	if (preflight && !preflight.current()) return { ok: false, code: "stale" };
	if (boundForm && adapter) return { ok: false, code: "invalid_witness" };
	const bound = boundForm ? selectBoundAdapter(boundForm, context, snapshot, guard, check) : undefined;
	if (bound && !bound.ok) return bound;
	const capture = bound?.capture;
	const selected = bound?.adapter ?? adapter;
	if (!selected) return { ok: false, code: "invalid_witness" };
	const candidate = prepareOwnedSubmitAdapter(
		{
			data: capture?.state.data ?? snapshot.data,
			uiState: capture?.state.uiState ?? snapshot.uiState,
			fieldPolicy: capture?.state.fieldPolicy ?? snapshot.fieldPolicy,
			...(snapshot.meta.stage === undefined ? {} : { stage: snapshot.meta.stage }),
		},
		selected,
		transforms,
		current,
		!!boundForm,
	);
	if (!current()) return { ok: false, code: "stale" };
	if (!candidate.ok) return candidate;
	if (boundForm && (!candidate.plan || !capture)) return { ok: false, code: "invalid_witness" };
	return boundForm
		? Object.freeze({ ok: true, revision, candidate: Object.freeze(candidate), ...(capture ? { capture } : {}) })
		: { ok: true, revision, candidate };
}
