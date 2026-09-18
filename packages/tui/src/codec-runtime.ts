import type { FormApi, FormDispatchResult } from "@formbar/core";
import type { MutableEditState } from "./edit-state.js";
import type { TuiFieldCodec, TuiPrimitive } from "./field-adapters.js";

type CheckedCodecResult<T> =
	| { readonly kind: "success"; readonly value: T }
	| { readonly kind: "rejected"; readonly message: string | undefined }
	| { readonly kind: "malformed" };

export function readDraftResult(codec: TuiFieldCodec, value: unknown): CheckedCodecResult<string | boolean> {
	return codec.mode === "boolean"
		? checkResult(() => codec.toDraft(value), isBoolean)
		: checkResult(() => codec.toDraft(value), isString);
}

export function readWriteResult(
	codec: TuiFieldCodec,
	draft: string,
	canonical: unknown,
): CheckedCodecResult<TuiPrimitive> {
	return checkResult(
		() => codec.fromDraft(draft),
		(value): value is TuiPrimitive => isWritablePrimitive(value) && samePrimitiveKind(value, canonical),
	);
}

export function validateSelectValue(codec: TuiFieldCodec, value: unknown): CheckedCodecResult<TuiPrimitive> {
	if (!isWritablePrimitive(value)) return { kind: "malformed" };
	const converted = readDraftResult(codec, value);
	return converted.kind === "success" ? { kind: "success", value } : converted;
}

export function acceptsCodecDraft(codec: TuiFieldCodec, draft: string): CheckedCodecResult<boolean> {
	try {
		const value = codec.acceptsDraft(draft);
		return typeof value === "boolean" ? { kind: "success", value } : { kind: "malformed" };
	} catch {
		return { kind: "malformed" };
	}
}

export function applyCodecFailure(
	state: MutableEditState,
	result: Exclude<CheckedCodecResult<unknown>, { kind: "success" }>,
): void {
	state.error = result.kind === "malformed" ? "Field adapter failed" : (result.message ?? "Invalid value");
	if (result.kind === "malformed") state.adapterFailed = true;
}

export function markAdapterFailure(state: MutableEditState): void {
	state.error = "Field adapter failed";
	state.adapterFailed = true;
}

export function writeCodecValue<TData, TUi>(
	form: FormApi<TData, TUi>,
	path: string,
	value: TuiPrimitive,
): FormDispatchResult {
	return form.dispatch({ type: "set-value", path, value });
}

export function applyWriteFailure(state: MutableEditState): void {
	state.wroteCanonical = false;
	state.error = "Field update rejected";
	state.adapterFailed = true;
}

function checkResult<T>(invoke: () => unknown, accepts: (value: unknown) => value is T): CheckedCodecResult<T> {
	try {
		const result = invoke();
		if (!isRecord(result) || !Object.hasOwn(result, "ok") || typeof result.ok !== "boolean")
			return { kind: "malformed" };
		if (result.ok === false) return checkedFailure(result);
		if (!Object.hasOwn(result, "value") || !accepts(result.value)) return { kind: "malformed" };
		return { kind: "success", value: result.value };
	} catch {
		return { kind: "malformed" };
	}
}

function checkedFailure(result: Record<string, unknown>): CheckedCodecResult<never> {
	if (!Object.hasOwn(result, "code") || typeof result.code !== "string" || result.code.length === 0)
		return { kind: "malformed" };
	if (result.message !== undefined && typeof result.message !== "string") return { kind: "malformed" };
	return { kind: "rejected", message: result.message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
	return typeof value === "string";
}

function isBoolean(value: unknown): value is boolean {
	return typeof value === "boolean";
}

function isWritablePrimitive(value: unknown): value is TuiPrimitive {
	return (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean" ||
		(typeof value === "number" && Number.isFinite(value))
	);
}

function samePrimitiveKind(value: TuiPrimitive, canonical: unknown): boolean {
	if (canonical === undefined) return typeof value === "string";
	if (canonical === null) return value === null;
	return typeof value === typeof canonical;
}
