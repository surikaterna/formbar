import type { ArrayFieldHelpers, FormApi } from "@formbar/core";
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

export function preflightAction(
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
	if (!state.target || state.target.namespace !== "data") return "invalid-action-target";
	if (policyBlocked(form, state)) return "action-unavailable";
	return arrayPlan(form, state) ? undefined : arrayFailure(form, state);
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
	void context.form.getState().issues;
	return asyncAborted(context.signal, result.status);
}

function runArray(form: FormApi<unknown, unknown>, state: ResolvedActionState): ActionDiagnosticCode | undefined {
	const plan = arrayPlan(form, state);
	if (!plan || !state.target) return arrayFailure(form, state);
	const field = form.fieldDynamic(pointer(state.target.segments)) as unknown as ArrayFieldHelpers<readonly JsonValue[]>;
	const result = applyArrayPlan(field, plan);
	return result.ok ? undefined : "action-failed";
}

function applyArrayPlan(field: ArrayFieldHelpers<readonly JsonValue[]>, plan: ArrayPlan) {
	if (plan.operation === "append") return field.pushValue(plan.item);
	if (plan.operation === "insert") return field.insertValue(plan.index, plan.item);
	if (plan.operation === "remove") return field.removeValue(plan.index);
	if (plan.operation === "move") return field.moveValue(plan.from, plan.to);
	return field.swapValue(plan.from, plan.to);
}

function arrayFailure(form: FormApi<unknown, unknown>, state: ResolvedActionState): ActionDiagnosticCode {
	if (!state.target || state.target.namespace !== "data") return "invalid-action-target";
	if (policyBlocked(form, state)) return "action-unavailable";
	const target = readTarget(form, state);
	return Array.isArray(target) ? "invalid-action-payload" : "invalid-action-target";
}

function arrayPlan(form: FormApi<unknown, unknown>, state: ResolvedActionState): ArrayPlan | undefined {
	if (!state.target || state.target.namespace !== "data" || policyBlocked(form, state)) return undefined;
	const value = readTarget(form, state);
	if (!Array.isArray(value)) return undefined;
	const payload = state.payload.status === "ready" ? state.payload.value : undefined;
	const fallback = state.instance.scopes.at(-1)?.index;
	if (state.action === "array.append" && payload !== undefined) return { operation: "append", item: payload };
	if (state.action === "array.insert") return insertPlan(payload, fallback, value.length);
	if (state.action === "array.remove") return removePlan(payload, fallback, value.length);
	if (state.action === "array.move" || state.action === "array.swap")
		return reorderPlan(state.action.slice(6) as "move" | "swap", payload, fallback, value.length);
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
): ArrayPlan | undefined {
	if (!isRecord(payload) || !exactKeys(payload, ["from", "to"]) || !Object.hasOwn(payload, "to")) return undefined;
	const from = payload.from === undefined ? fallback : payload.from;
	if (!validIndex(from, length, false) || !validIndex(payload.to, length, false)) return undefined;
	return { operation, from, to: payload.to };
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

function readTarget(form: FormApi<unknown, unknown>, state: ResolvedActionState): unknown {
	let value: unknown = form.getState().data;
	for (const segment of state.target?.segments ?? []) {
		if (value === null || typeof value !== "object" || !Object.hasOwn(value, segment)) return undefined;
		value = (value as Record<string | number, unknown>)[segment];
	}
	return value;
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
