import type { JsonValue } from "./contracts.js";
import { ExpressionError } from "./result.js";

export const isJsonArray = (value: JsonValue): value is readonly JsonValue[] => Array.isArray(value);

export function jsonRecord(value: JsonValue): Readonly<Record<string, JsonValue>> {
	if (value === null || typeof value !== "object" || isJsonArray(value)) throw new ExpressionError("invalid-input");
	return value;
}

export function exactKeys(node: object, allowed: readonly string[]): void {
	if (Object.keys(node).some((key) => !allowed.includes(key))) throw new ExpressionError("invalid-input");
}
