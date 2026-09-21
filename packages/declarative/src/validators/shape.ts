import type { JsonValue } from "@formbar/expressions";
import type { DiagnosticPathSegment } from "../diagnostics.js";
import { type ValidationContext, diagnostic } from "./context.js";

export type JsonRecord = Readonly<Record<string, JsonValue>>;

export function record(
	value: JsonValue,
	path: readonly DiagnosticPathSegment[],
	context: ValidationContext,
): JsonRecord | undefined {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		diagnostic(context, "invalid-type", path, "Expected an object.");
		return undefined;
	}
	return value as JsonRecord;
}

export function array(
	value: JsonValue | undefined,
	path: readonly DiagnosticPathSegment[],
	context: ValidationContext,
): readonly JsonValue[] | undefined {
	if (Array.isArray(value)) return value;
	diagnostic(context, value === undefined ? "required" : "invalid-type", path, "Expected an array.");
	return undefined;
}

export function exactKeys(
	value: JsonRecord,
	allowed: ReadonlySet<string>,
	path: readonly DiagnosticPathSegment[],
	context: ValidationContext,
): void {
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) diagnostic(context, "unknown-key", [...path, key], `Unknown property '${key}'.`);
	}
}

export function identifier(
	value: JsonValue | undefined,
	path: readonly DiagnosticPathSegment[],
	context: ValidationContext,
): string | undefined {
	if (typeof value === "string" && value.length > 0 && value.length <= 256 && !UNSAFE_NAMES.has(value)) return value;
	diagnostic(context, value === undefined ? "required" : "invalid-type", path, "Expected a safe non-empty string ID.");
	return undefined;
}

export function optionalString(
	value: JsonValue | undefined,
	path: readonly DiagnosticPathSegment[],
	context: ValidationContext,
): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "string") return value;
	diagnostic(context, "invalid-type", path, "Expected a string.");
	return undefined;
}

export function optionalInteger(
	value: JsonValue | undefined,
	path: readonly DiagnosticPathSegment[],
	context: ValidationContext,
): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
	diagnostic(context, "invalid-range", path, "Expected a non-negative safe integer.");
	return undefined;
}

const UNSAFE_NAMES = new Set(["__proto__", "constructor", "prototype"]);
