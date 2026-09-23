import type { ArrayFieldHelpers, FormApi } from "@formbar/core";
import { copyJson, readOwn } from "@formbar/expressions";
import type { JsonValue } from "@formbar/expressions";
import { BUILT_IN_ACTIONS } from "./action-registry.js";
import type { ActionDiagnosticCode } from "./actions.js";
import type { ResolvedActionState } from "./runtime-contracts.js";

interface BuiltInContext {
	readonly form: FormApi<unknown, unknown>;
	readonly state: ResolvedActionState;
	readonly signal: AbortSignal;
	readonly reset: () => void;
}

type ArrayPlan =
	| { readonly operation: "append"; readonly item: JsonValue }
	| { readonly operation: "insert"; readonly item: JsonValue; readonly index: number }
	| { readonly operation: "remove"; readonly index: number }
	| { readonly operation: "move" | "swap"; readonly from: number; readonly to: number };

type ArrayPreparation =
	| { readonly plan: ArrayPlan; readonly target: readonly (string | number)[] }
	| { readonly diagnostic: ActionDiagnosticCode };

type JsonCopyResult = { readonly ok: true; readonly value: JsonValue } | { readonly ok: false };

export function preflightAction(
	form: FormApi<unknown, unknown>,
	state: ResolvedActionState | undefined,
	hasCustomHandler: boolean,
): ActionDiagnosticCode | undefined {
	try {
		return preflightActionUnsafe(form, state, hasCustomHandler);
	} catch {
		return state?.action.startsWith("array.") ? "invalid-action-target" : "action-failed";
	}
}

function preflightActionUnsafe(
	form: FormApi<unknown, unknown>,
	state: ResolvedActionState | undefined,
	hasCustomHandler: boolean,
): ActionDiagnosticCode | undefined {
	if (!state) return "action-unavailable";
	if (!state.visible || state.disabled || state.readOnly) return "action-unavailable";
	if (form.isSubmitting() && state.action !== "reset") return "action-unavailable";
	if (state.payload.status === "error") return "invalid-action-payload";
	if (!BUILT_IN_ACTIONS.has(state.action)) return hasCustomHandler ? undefined : "unknown-action";
	if (!state.action.startsWith("array.")) return undefined;
	const preparation = prepareArray(form, state);
	return "diagnostic" in preparation ? preparation.diagnostic : undefined;
}

export async function runBuiltIn(context: BuiltInContext): Promise<ActionDiagnosticCode | undefined> {
	if (context.signal.aborted) return "action-aborted";
	if (context.state.action === "submit") {
		await context.form.submit(undefined, context.signal);
		return undefined;
	}
	if (context.state.action === "reset") {
		context.reset();
		return undefined;
	}
	if (context.state.action === "validate") return runValidate(context);
	return runArray(context.form, context.state);
}

function asyncAborted(signal: AbortSignal, status: string): ActionDiagnosticCode | undefined {
	return signal.aborted || status === "aborted" || status === "superseded" ? "action-aborted" : undefined;
}

async function runValidate(context: BuiltInContext): Promise<ActionDiagnosticCode | undefined> {
	const dispatched = context.form.dispatch({ type: "validate", origin: "declarative-action" });
	if (!dispatched.ok) return "action-failed";
	const result = await context.form.validateAsync(undefined, context.signal);
	return asyncAborted(context.signal, result.status);
}

function runArray(form: FormApi<unknown, unknown>, state: ResolvedActionState): ActionDiagnosticCode | undefined {
	try {
		return runArrayUnsafe(form, state);
	} catch {
		return "action-failed";
	}
}

function runArrayUnsafe(form: FormApi<unknown, unknown>, state: ResolvedActionState): ActionDiagnosticCode | undefined {
	const preparation = prepareArray(form, state);
	if ("diagnostic" in preparation) return preparation.diagnostic;
	const field = form.fieldDynamic(pointer(preparation.target)) as unknown as ArrayFieldHelpers<readonly JsonValue[]>;
	const result = applyArrayPlan(field, preparation.plan);
	return result.ok ? undefined : "action-failed";
}

function applyArrayPlan(field: ArrayFieldHelpers<readonly JsonValue[]>, plan: ArrayPlan) {
	if (plan.operation === "append") return field.pushValue(plan.item);
	if (plan.operation === "insert") return field.insertValue(plan.index, plan.item);
	if (plan.operation === "remove") return field.removeValue(plan.index);
	if (plan.operation === "move") return field.moveValue(plan.from, plan.to);
	return field.swapValue(plan.from, plan.to);
}

function prepareArray(form: FormApi<unknown, unknown>, state: ResolvedActionState): ArrayPreparation {
	if (!state.target || state.target.namespace !== "data") return { diagnostic: "invalid-action-target" };
	try {
		if (policyBlocked(form, state)) return { diagnostic: "action-unavailable" };
	} catch {
		return { diagnostic: "invalid-action-target" };
	}
	const target = readTarget(form, state);
	if (!target.ok) return { diagnostic: "invalid-action-target" };
	const value = target.value;
	let length: number;
	try {
		if (!Array.isArray(value)) return { diagnostic: "invalid-action-target" };
		length = value.length;
		if (!Number.isSafeInteger(length) || length < 0) return { diagnostic: "invalid-action-target" };
	} catch {
		return { diagnostic: "invalid-action-target" };
	}
	try {
		const plan = arrayPlan(state, length);
		if (!plan) return { diagnostic: "invalid-action-payload" };
		if (typeof plan === "string") return { diagnostic: plan };
		const limit = limitDiagnostic(state, plan, length);
		return limit ? { diagnostic: limit } : { plan, target: state.target.segments };
	} catch {
		return { diagnostic: "invalid-action-payload" };
	}
}

function arrayPlan(state: ResolvedActionState, length: number): ArrayPlan | ActionDiagnosticCode | undefined {
	const payloadValue = state.payload.status === "ready" ? copyActionPayload(state.payload.value) : undefined;
	if (payloadValue && !payloadValue.ok) return undefined;
	const payload = payloadValue?.value;
	const fallback = state.instance.scopes.at(-1)?.index;
	if (state.action === "array.append" && payload !== undefined) return { operation: "append", item: payload };
	if (state.action === "array.insert") return insertPlan(payload, fallback, length);
	if (state.action === "array.remove") return removePlan(payload, fallback, length);
	if (state.action === "array.move" || state.action === "array.swap")
		return reorderPlan(state.action.slice(6) as "move" | "swap", payload, fallback, length);
	return undefined;
}

function insertPlan(
	payload: JsonValue | undefined,
	fallback: number | undefined,
	length: number,
): ArrayPlan | undefined {
	if (!isRecord(payload) || !exactKeys(payload, ["item", "index"]) || !Object.hasOwn(payload, "item")) return undefined;
	const index = payload.index === undefined ? fallback : payload.index;
	if (!validIndex(index, length, true)) return undefined;
	return { operation: "insert", item: payload.item as JsonValue, index };
}

function removePlan(
	payload: JsonValue | undefined,
	fallback: number | undefined,
	length: number,
): ArrayPlan | undefined {
	const index = payload === undefined ? fallback : payload;
	return validIndex(index, length, false) ? { operation: "remove", index } : undefined;
}

function reorderPlan(
	operation: "move" | "swap",
	payload: JsonValue | undefined,
	fallback: number | undefined,
	length: number,
): ArrayPlan | ActionDiagnosticCode | undefined {
	if (!isRecord(payload)) return undefined;
	if (exactKeys(payload, ["offset"]) && Object.hasOwn(payload, "offset")) {
		if (payload.offset !== -1 && payload.offset !== 1) return undefined;
		if (!Number.isSafeInteger(fallback)) return undefined;
		const to = (fallback as number) + payload.offset;
		if (!validIndex(to, length, false)) return "array-boundary";
		return { operation, from: fallback as number, to };
	}
	if (!exactKeys(payload, ["from", "to"]) || !Object.hasOwn(payload, "to")) return undefined;
	const from = payload.from === undefined ? fallback : payload.from;
	if (!Number.isSafeInteger(from) || !Number.isSafeInteger(payload.to)) return undefined;
	if (!validIndex(from, length, false) || !validIndex(payload.to, length, false) || from === payload.to)
		return "array-boundary";
	return { operation, from, to: payload.to };
}

function limitDiagnostic(
	state: ResolvedActionState,
	plan: ArrayPlan,
	length: number,
): ActionDiagnosticCode | undefined {
	const limits = state.arrayLimits;
	if (!limits) return undefined;
	if (limits.conflict) return "action-unavailable";
	if ((plan.operation === "append" || plan.operation === "insert") && limits.maxItems !== undefined) {
		if (length >= limits.maxItems) return "array-max-items";
	}
	if (plan.operation === "remove" && length <= limits.minItems) return "array-min-items";
	return undefined;
}

function validIndex(value: unknown, length: number, endpoint: boolean): value is number {
	return (
		Number.isSafeInteger(value) &&
		(value as number) >= 0 &&
		(endpoint ? (value as number) <= length : (value as number) < length)
	);
}

function isRecord(value: JsonValue | undefined): value is Readonly<Record<string, JsonValue>> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Readonly<Record<string, JsonValue>>, keys: readonly string[]): boolean {
	return Object.keys(value).every((key) => keys.includes(key));
}

function copyActionPayload(value: JsonValue): JsonCopyResult {
	try {
		return { ok: true, value: copyJson(value) };
	} catch {
		return { ok: false };
	}
}

function readTarget(
	form: FormApi<unknown, unknown>,
	state: ResolvedActionState,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
	try {
		return { ok: true, value: readOwn(form.getState().data, state.target?.segments ?? []) };
	} catch {
		return { ok: false };
	}
}

function policyBlocked(form: FormApi<unknown, unknown>, state: ResolvedActionState): boolean {
	const segments = state.target?.segments;
	if (!segments) return true;
	return form
		.getState()
		.fieldPolicy.some(
			(policy) =>
				policy.path.segments.length === segments.length &&
				policy.path.segments.every((segment, index) => segment === segments[index]) &&
				(policy.visible === false || policy.disabled === true || policy.readOnly === true),
		);
}

function pointer(segments: readonly (string | number)[]): string {
	return `/${segments.map((segment) => String(segment).replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`;
}
