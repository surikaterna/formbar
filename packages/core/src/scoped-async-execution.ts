import type { FormApi } from "./contracts.js";
import { createIssueEmission } from "./issue-provenance.js";
import type { CanonicalSegment } from "./path.js";
import type { ScopedAsyncField } from "./scoped-async.js";
import type { scopedCaptureReceipt } from "./scoped-capture-receipt.js";
import { scopedLifecycleRevision } from "./scoped-sync.js";
import type { FormStateCapture, SubmitContext, ValidationIssue } from "./state.js";

export interface AsyncProjection<TData, TUi> {
	readonly form: FormApi<TData, TUi>;
	readonly capture: FormStateCapture<TData, TUi>;
	readonly projectionCurrent: () => boolean;
	readonly revision: number;
	readonly currentRevision: () => number;
	readonly signal: AbortSignal;
	readonly receipt: ReturnType<typeof scopedCaptureReceipt<TData, TUi>>;
	readonly stage?: string;
	readonly context?: SubmitContext;
}

export function asyncProjectionCurrent<TData, TUi>(projection: AsyncProjection<TData, TUi>): boolean {
	return (
		!projection.signal.aborted &&
		projection.currentRevision() === projection.revision &&
		projection.receipt(projection.form.getState()) &&
		projection.projectionCurrent()
	);
}

function boundValue(data: unknown, segments: readonly CanonicalSegment[]): boolean {
	let value = data;
	for (const segment of segments) {
		if (value === null || typeof value !== "object") return false;
		if (Array.isArray(value) !== (typeof segment === "number")) return false;
		if (!Object.hasOwn(value, segment)) return false;
		value = (value as Record<string | number, unknown>)[segment];
	}
	return value !== undefined;
}

export async function runScopedAsyncField<TData, TUi>(
	field: ScopedAsyncField,
	projection: AsyncProjection<TData, TUi>,
): Promise<readonly ValidationIssue[]> {
	const lifecycle = scopedLifecycleRevision(projection.form);
	const current = () => scopedLifecycleRevision(projection.form) === lifecycle && asyncProjectionCurrent(projection);
	const { data, uiState, meta } = projection.capture.state;
	if (!current() || !field.binding.segments.length || !boundValue(data, field.binding.segments))
		throw new Error("Invalid scoped async field binding");
	const result = await field.validate({
		data,
		uiState,
		signal: projection.signal,
		...(projection.stage === undefined ? {} : { stage: projection.stage }),
		...(projection.context ? { context: projection.context } : {}),
	});
	if (!Array.isArray(result) || !current()) throw new Error("Invalid or stale scoped async result");
	const emit = createIssueEmission({
		fieldId: field.fieldId,
		instanceKey: field.instanceKey,
		binding: field.binding,
		revision: projection.revision,
		run: projection,
		current,
		signal: projection.signal,
		asyncValidatorId: field.id,
	});
	return result.map((input) => {
		if (
			!input ||
			typeof input !== "object" ||
			Object.keys(input).some((key) => !["code", "message", "severity", "descendant"].includes(key)) ||
			typeof input.code !== "string" ||
			!input.code ||
			typeof input.message !== "string" ||
			!["error", "warning", "info"].includes(input.severity) ||
			(input.descendant !== undefined &&
				(!Array.isArray(input.descendant) ||
					!input.descendant.length ||
					!boundValue(data, [...field.binding.segments, ...input.descendant])))
		)
			throw new Error("Invalid scoped async issue");
		return emit({ ...input, stage: meta.stage });
	});
}
