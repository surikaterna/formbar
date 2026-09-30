import { copyJson } from "@formbar/expressions";
import type {
	DataContext,
	FormbarDataStrategyV1,
	LifecycleField,
	LifecycleFrame,
	LifecycleRequest,
	LifecycleStatus,
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
	| { readonly ok: false; readonly code: LifecycleDiagnostic };

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

/** One host frame; status and baseline are never inferred from rendered nodes. */
function captureFrame(
	strategy: FormbarDataStrategyV1,
	context: DataContext,
	live: () => boolean,
	fresh: (revision: object) => boolean,
): LifecycleRead<LifecycleFrame> {
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
	capture: () => LifecycleRead<LifecycleFrame>,
	context: DataContext,
): LifecycleRead<LifecycleRequest> {
	const result = capture();
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

export function privateLifecycle(strategy: FormbarDataStrategyV1, context: DataContext, live: () => boolean) {
	const fresh = (revision: object) => live() && revision === strategy.current(context);
	const capture = () => captureFrame(strategy, context, live, fresh);
	const request = () => lifecycleRequest(capture, context);
	return {
		capture,
		field(field: LifecycleField): LifecycleRead<LifecycleStatus> {
			const frame = capture();
			if (!frame.ok) return frame;
			try {
				const result = frame.value.field(field);
				return result.status === "found" ? { ok: true, value: result.value } : fail(diagnostic(result.status));
			} catch {
				return fail("STRATEGY_ERROR");
			}
		},
		async validate(): Promise<LifecycleRead<void>> {
			if (!strategy.validateLifecycle) return fail("LIFECYCLE_UNAVAILABLE");
			const captured = request();
			if (!captured.ok) return captured;
			try {
				const { revision } = captured.value;
				if (!fresh(revision)) return fail("STALE_CAPTURE");
				const result = await strategy.validateLifecycle(context, captured.value, () => fresh(revision));
				if (result.status !== "applied") return fail(diagnostic(result.status));
				return live() && result.revision === strategy.current(context)
					? { ok: true, value: undefined }
					: fail("STALE_CAPTURE");
			} catch {
				return fail("STRATEGY_ERROR");
			}
		},
		reset(): LifecycleRead<void> {
			if (!strategy.resetLifecycle) return fail("LIFECYCLE_UNAVAILABLE");
			const captured = request();
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
		},
	};
}
