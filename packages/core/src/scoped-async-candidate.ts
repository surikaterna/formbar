import type { FormApi } from "./contracts.js";
import { runScopedForeground } from "./scoped-async-foreground-run.js";
import { scopedAsyncHost } from "./scoped-async.js";
import { scopedCaptureReceipt } from "./scoped-capture-receipt.js";
import type { FormStateCapture, SubmitContext, ValidationIssue } from "./state.js";
import type { CoordinatorDeps } from "./validation-coordinator-deps.js";

/** A FINAL run has its own projection and issue lane; it never stages draft emissions. */
export function runScopedCandidate<TData, TUi>(
	form: FormApi<TData, TUi>,
	snapshot: { readonly data: TData; readonly uiState: TUi },
	stage: string | undefined,
	context: SubmitContext | undefined,
	signal: AbortSignal,
	revision: number,
	currentRevision: () => number,
	retainedCapture?: FormStateCapture<TData, TUi>,
): Promise<readonly ValidationIssue[]> {
	const host = scopedAsyncHost(form);
	if (!host) return Promise.resolve([]);
	const capture = retainedCapture ?? form.captureState();
	const receipt = scopedCaptureReceipt(capture);
	const candidateCapture = {
		...capture,
		state: {
			...capture.state,
			data: snapshot.data,
			uiState: snapshot.uiState,
			meta: { ...capture.state.meta, ...(stage === undefined ? {} : { stage }) },
		},
	};
	const projection = host.instances(form, candidateCapture, capture);
	if (!projection.current() || !receipt(form.getState())) throw new Error("Stale scoped FINAL projection");
	return runScopedForeground(
		projection.fields,
		{
			form,
			capture: candidateCapture,
			projectionCurrent: projection.current,
			revision,
			currentRevision,
			signal,
			receipt,
			...(stage === undefined ? {} : { stage }),
			...(context ? { context } : {}),
		},
		new Map(),
	);
}

export function createScopedCandidateRunner<TData, TUi>(
	current: () => readonly [FormApi<TData, TUi>, number],
): NonNullable<CoordinatorDeps<TData, TUi>["runScopedCandidate"]> {
	return (snapshot, signal, expected, options) => {
		const [form] = current();
		return runScopedCandidate(
			form,
			snapshot,
			options?.stage,
			options?.context,
			signal,
			expected,
			() => current()[1],
			options?.capture,
		);
	};
}
