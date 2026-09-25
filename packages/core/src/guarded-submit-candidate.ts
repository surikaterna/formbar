import type { PipelineContext } from "./pipeline.js";
import { executeSubmitPreparation } from "./pipeline.js";
import type { FormState } from "./state.js";
import type { SubmitDefinitionAdapter } from "./submit-adapter-contract.js";
import { Boundary, unchanged } from "./submit-candidate-safety.js";
import type { CandidateEgress } from "./submit-candidate-safety.js";
import { prepareOwnedSubmitAdapter } from "./submit-owned-adapter.js";
import type { SubmitPreparationGuard } from "./submit-preparation-checkpoint.js";

type Candidate = ReturnType<typeof prepareOwnedSubmitAdapter>;
type Preparation =
	| { readonly ok: true; readonly revision: number; readonly candidate: Extract<Candidate, { ok: true }> }
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

/** Internal B handoff only: C/D own validation, handler and public activation. */
export function prepareGuardedSubmitCandidate(
	context: PipelineContext,
	guard: SubmitPreparationGuard,
	adapter: SubmitDefinitionAdapter,
	transforms: readonly CandidateEgress[] = [],
): Preparation {
	const prepared = executeSubmitPreparation(context, guard);
	if (prepared.stage === "rejected") return { ok: false, code: "vetoed" };
	const { snapshot, revision } = prepared;
	const current = () =>
		!guard.signal.aborted &&
		guard.isActive?.() !== false &&
		guard.revision() === revision &&
		context.store.getState() === snapshot;
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
	const candidate = prepareOwnedSubmitAdapter(
		{
			data: snapshot.data,
			uiState: snapshot.uiState,
			fieldPolicy: snapshot.fieldPolicy,
			...(snapshot.meta.stage === undefined ? {} : { stage: snapshot.meta.stage }),
		},
		adapter,
		transforms,
		current,
	);
	if (!current()) return { ok: false, code: "stale" };
	return candidate.ok ? { ok: true, revision, candidate } : candidate;
}
