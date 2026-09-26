import type { PipelineContext } from "./pipeline.js";
import type { FormState, SubmitContext } from "./state.js";
import { snapshotOwnership } from "./store.js";
import { clone, freeze, unchanged } from "./submit-candidate-safety.js";
import type { SubmitPreparationGuard } from "./submit-preparation-checkpoint.js";
import type { ValidationCoordinator } from "./validation-coordinator.js";

export interface CandidateValidationContext {
	readonly stage: string | undefined;
	readonly submitContext: SubmitContext | undefined;
	readonly current: () => boolean;
	readonly state: FormState<unknown, unknown>;
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

export function candidateValidationContext(
	context: PipelineContext,
	guard: SubmitPreparationGuard,
	coordinator: ValidationCoordinator<unknown, unknown>,
	data: unknown,
	uiState: unknown,
	revision: number,
): CandidateValidationContext | undefined {
	const retained = context.store.getState();
	const retainedBaseline = freeze(
		clone({ data: retained.data, uiState: retained.uiState, policy: retained.fieldPolicy }).value,
	);
	const owner = snapshotOwnership(retained);
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
		context.store.getState().meta.stage === stage &&
		(!owner?.owned ||
			(snapshotOwnership(context.store.getState())?.write === owner.write &&
				snapshotOwnership(context.store.getState())?.epoch === owner.epoch)) &&
		unchanged(
			{
				data: context.store.getState().data,
				uiState: context.store.getState().uiState,
				policy: context.store.getState().fieldPolicy,
			},
			retainedBaseline,
		) &&
		unchanged({ data, uiState }, baseline);
	return { stage, submitContext, current, state };
}
