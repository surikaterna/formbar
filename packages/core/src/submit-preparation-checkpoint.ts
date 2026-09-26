import { structuredEqual } from "./equality.js";
import { sameOwnedJson } from "./owned-issue-snapshot.js";
import type { PipelineContext, PipelineResult } from "./pipeline.js";
import type { FormState } from "./state.js";
import { snapshotOwnership } from "./store.js";

export interface SubmitPreparationGuard {
	readonly signal: AbortSignal;
	readonly expectedRevision: number;
	readonly revision: () => number;
	readonly onCommittedMutation: () => void;
	readonly isActive?: () => boolean;
}

export interface PreparationCheckpoint {
	readonly failure: () => PipelineResult | undefined;
	readonly valid: () => boolean;
	readonly committed: (state: FormState<unknown, unknown>, previous: FormState<unknown, unknown>) => void;
}

export function createCheckpoint(ctx: PipelineContext, guard: SubmitPreparationGuard): PreparationCheckpoint {
	let expected = guard.expectedRevision;
	let snapshot = ctx.store.getState();
	const failure = (): PipelineResult | undefined => {
		if (guard.signal.aborted || guard.isActive?.() === false) return { ok: false, error: "Submit preparation aborted" };
		if (guard.revision() !== expected || ctx.store.getState() !== snapshot)
			return { ok: false, error: "Submit preparation superseded" };
	};
	return {
		failure,
		valid: () => !failure(),
		committed: (state, previous) => {
			// Called after assignment and before subscriber and afterAction callbacks.
			const equal = snapshotOwnership(state)?.owned ? sameOwnedJson : structuredEqual;
			if (!equal(previous.data, state.data) || !equal(previous.uiState, state.uiState)) {
				guard.onCommittedMutation();
				expected += 1;
			}
			snapshot = state;
		},
	};
}
