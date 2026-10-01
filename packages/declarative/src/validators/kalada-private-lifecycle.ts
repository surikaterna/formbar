import { copyJson } from "@formbar/expressions";
import type {
	DataContext,
	FormbarDataStrategyV1,
	LifecycleField,
	LifecycleFrame,
	LifecycleRequest,
	LifecycleStatus,
	OperationFenceV1,
} from "./kalada-data-strategy.js";

export type LifecycleDiagnostic =
	| "LIFECYCLE_UNAVAILABLE"
	| "STALE_CAPTURE"
	| "LIFECYCLE_DENIED"
	| "LIFECYCLE_MISSING"
	| "LIFECYCLE_CONFLICT"
	| "LIFECYCLE_INVALID"
	| "STRATEGY_ERROR";
export type LifecycleRead<T> =
	| { readonly ok: true; readonly value: T }
	| {
			readonly ok: false;
			readonly code: LifecycleDiagnostic;
	  };

const fail = (code: LifecycleDiagnostic) => ({ ok: false as const, code });
const diagnostic = (status: string): LifecycleDiagnostic => {
	switch (status) {
		case "denied":
			return "LIFECYCLE_DENIED";
		case "missing":
			return "LIFECYCLE_MISSING";
		case "conflict":
			return "LIFECYCLE_CONFLICT";
		case "invalid":
			return "LIFECYCLE_INVALID";
		case "unsupported":
			return "LIFECYCLE_UNAVAILABLE";
		default:
			return "STALE_CAPTURE";
	}
};

function snapshotStatus(status: LifecycleStatus): LifecycleStatus {
	const submitCount = status.submitCount ?? 0;
	if (!Number.isSafeInteger(submitCount) || submitCount < 0) throw new Error("invalid submit count");
	if (
		![status.dirty, status.touched, status.validating, status.submitted, status.valid].every(
			(value) => typeof value === "boolean",
		) ||
		!Array.isArray(status.issues.schema) ||
		!Array.isArray(status.issues.extension) ||
		![...status.issues.schema, ...status.issues.extension].every((issue) => typeof issue === "string")
	)
		throw new Error("invalid lifecycle status");
	return Object.freeze({
		submitCount,
		dirty: status.dirty,
		touched: status.touched,
		validating: status.validating,
		submitted: status.submitted,
		valid: status.valid,
		issues: Object.freeze({
			schema: Object.freeze([...status.issues.schema]),
			extension: Object.freeze([...status.issues.extension]),
		}),
	});
}

/** A single revision-bound host frame; neither status nor baseline is inferred from rendered nodes. */
function captureLifecycle(
	strategy: FormbarDataStrategyV1,
	context: DataContext,
	live: () => boolean,
): LifecycleRead<LifecycleFrame> {
	const fresh = (revision: object) => live() && revision === strategy.current(context);
	if (!strategy.captureLifecycle) return fail("LIFECYCLE_UNAVAILABLE");
	try {
		if (!live()) return fail("STALE_CAPTURE");
		const frame = strategy.captureLifecycle(context);
		if ("status" in frame) return fail(diagnostic(frame.status));
		if (frame.instance !== context.instance || !frame.revision || !fresh(frame.revision)) return fail("STALE_CAPTURE");
		const form = snapshotStatus(frame.form);
		const initial = copyJson(frame.initial);
		if (!fresh(frame.revision)) return fail("STALE_CAPTURE");
		return {
			ok: true,
			value: Object.freeze({
				instance: frame.instance,
				revision: frame.revision,
				form,
				initial,
				field(field: LifecycleField) {
					if (!fresh(frame.revision)) return { status: "stale" } as const;
					const result = frame.field(field);
					if (!fresh(frame.revision)) return { status: "stale" } as const;
					return result.status === "found" ? { status: "found" as const, value: snapshotStatus(result.value) } : result;
				},
			}),
		};
	} catch {
		return fail("STRATEGY_ERROR");
	}
}

function lifecycleRequest(
	strategy: FormbarDataStrategyV1,
	context: DataContext,
	live: () => boolean,
): LifecycleRead<LifecycleRequest> {
	const result = captureLifecycle(strategy, context, live);
	if (!result.ok) return result;
	return {
		ok: true,
		value: Object.freeze({
			contract: "formbar-lifecycle-v1",
			instance: context.instance,
			revision: result.value.revision,
		}),
	};
}

async function validateLifecycle(
	strategy: FormbarDataStrategyV1,
	context: DataContext,
	live: () => boolean,
	operation?: OperationFenceV1,
	submissionAttempt = false,
): Promise<LifecycleRead<void>> {
	const fresh = (revision: object) => live() && revision === strategy.current(context);
	if (!strategy.validateLifecycle) return fail("LIFECYCLE_UNAVAILABLE");
	const captured = lifecycleRequest(strategy, context, live);
	if (!captured.ok) return captured;
	try {
		const { revision } = captured.value;
		if (!fresh(revision)) return fail("STALE_CAPTURE");
		const result = await strategy.validateLifecycle(
			context,
			{
				...captured.value,
				...(operation ? { operation } : {}),
				...(submissionAttempt ? { submissionAttempt: true } : {}),
			},
			() => (operation ? operation.fresh() : fresh(revision)),
		);
		if (result.status !== "applied") return fail(diagnostic(result.status));
		return live() && result.revision === strategy.current(context)
			? { ok: true, value: undefined }
			: fail("STALE_CAPTURE");
	} catch {
		return fail("STRATEGY_ERROR");
	}
}

function resetLifecycle(
	strategy: FormbarDataStrategyV1,
	context: DataContext,
	live: () => boolean,
): LifecycleRead<void> {
	const fresh = (revision: object) => live() && revision === strategy.current(context);
	if (!strategy.resetLifecycle) return fail("LIFECYCLE_UNAVAILABLE");
	const captured = lifecycleRequest(strategy, context, live);
	if (!captured.ok) return captured;
	try {
		if (!fresh(captured.value.revision)) return fail("STALE_CAPTURE");
		const result = strategy.resetLifecycle(context, captured.value);
		if (result.status !== "applied") return fail(diagnostic(result.status));
		return live() && result.revision === strategy.current(context)
			? { ok: true, value: undefined }
			: fail("STALE_CAPTURE");
	} catch {
		return fail("STRATEGY_ERROR");
	}
}

export function privateLifecycle(strategy: FormbarDataStrategyV1, context: DataContext, live: () => boolean) {
	return {
		capture: () => captureLifecycle(strategy, context, live),
		field(field: LifecycleField): LifecycleRead<LifecycleStatus> {
			const frame = captureLifecycle(strategy, context, live);
			if (!frame.ok) return frame;
			try {
				const result = frame.value.field(field);
				return result.status === "found" ? { ok: true, value: result.value } : fail(diagnostic(result.status));
			} catch {
				return fail("STRATEGY_ERROR");
			}
		},
		validate: (operation?: OperationFenceV1, submissionAttempt = false) =>
			validateLifecycle(strategy, context, live, operation, submissionAttempt),
		reset: () => resetLifecycle(strategy, context, live),
	};
}
