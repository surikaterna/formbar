import type { FormApi } from "./contracts.js";
import type { ScopedAsyncField } from "./scoped-async.js";
import { emitScopedIssues, scopedCaptureCurrent, scopedLifecycleRevision, valueAt } from "./scoped-sync.js";
import type { FormStateCapture, ValidationIssue } from "./state.js";

export interface AsyncProjection<TData, TUi> {
	readonly form: FormApi<TData, TUi>;
	readonly capture: FormStateCapture<TData, TUi>;
	readonly fields: readonly ScopedAsyncField[];
	readonly projectionCurrent: () => boolean;
	readonly revision: number;
	readonly currentRevision: () => number;
	readonly signal: AbortSignal;
}

export function asyncProjectionCurrent<TData, TUi>(projection: AsyncProjection<TData, TUi>): boolean {
	return (
		!projection.signal.aborted &&
		projection.currentRevision() === projection.revision &&
		scopedCaptureCurrent(projection.form, projection.capture) &&
		projection.projectionCurrent()
	);
}

export async function runScopedAsyncField<TData, TUi>(
	field: ScopedAsyncField,
	projection: AsyncProjection<TData, TUi>,
): Promise<readonly ValidationIssue[]> {
	const lifecycle = scopedLifecycleRevision(projection.form);
	const current = () => scopedLifecycleRevision(projection.form) === lifecycle && asyncProjectionCurrent(projection);
	if (!current() || !field.binding.segments.length || !valueAt(projection.capture.state.data, field.binding.segments))
		throw new Error("Invalid scoped async field binding");
	const result = await field.validate({
		data: projection.capture.state.data,
		uiState: projection.capture.state.uiState,
		signal: projection.signal,
	});
	if (!Array.isArray(result) || !current()) throw new Error("Invalid or stale scoped async result");
	return emitScopedIssues(field, result, {
		captureData: projection.capture.state.data,
		snapshotData: projection.capture.state.data,
		stage: projection.capture.state.meta.stage,
		current,
		generation: projection.revision,
		run: {},
		guarded: false,
		asyncValidatorId: field.id,
	});
}
