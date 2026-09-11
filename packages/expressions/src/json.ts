import type { JsonValue } from "./contracts.js";
import { ExpressionError } from "./result.js";

export const LIMITS = Object.freeze({ depth: 32, nodes: 1024, args: 32, segments: 64, string: 16384 });
const unsafe = new Set(["__proto__", "constructor", "prototype"]);
export const safeName = (value: unknown): value is string =>
	typeof value === "string" && value.length > 0 && value.length <= 256 && !unsafe.has(value);

/** Copy before trusting: rejects accessors, sparse arrays, cycles, and non-JSON prototypes. */
export function copyJson(input: unknown): JsonValue {
	try {
		const budget = { remaining: LIMITS.nodes };
		return copyValue(input, 0, budget);
	} catch (error) {
		if (error instanceof ExpressionError) throw error;
		throw new ExpressionError("invalid-input");
	}
}

function copyValue(input: unknown, depth: number, budget: { remaining: number }): JsonValue {
	if (depth > LIMITS.depth || --budget.remaining < 0) throw new ExpressionError("limit");
	if (input === null || typeof input === "boolean") return input;
	if (typeof input === "number") {
		if (!Number.isFinite(input)) throw new ExpressionError("non-finite");
		return input === 0 ? 0 : input;
	}
	if (typeof input === "string") {
		if (input.length > LIMITS.string) throw new ExpressionError("limit");
		return input;
	}
	if (typeof input !== "object") throw new ExpressionError("invalid-input");
	return copyObject(input, depth, budget);
}

function copyObject(input: object, depth: number, budget: { remaining: number }): JsonValue {
	const proto = Object.getPrototypeOf(input);
	if (Array.isArray(input)) return copyArray(input, depth, budget);
	if (proto !== Object.prototype && proto !== null) throw new ExpressionError("invalid-input");
	const keys = Reflect.ownKeys(input);
	if (keys.length > LIMITS.nodes) throw new ExpressionError("limit");
	const output: Record<string, JsonValue> = Object.create(null);
	for (const key of keys) {
		if (typeof key !== "string" || unsafe.has(key)) throw new ExpressionError("invalid-input");
		if (key.length >= LIMITS.string) throw new ExpressionError("limit");
		output[key] = copyValue(ownValue(input, key), depth + 1, budget);
	}
	return Object.freeze(output);
}

function copyArray(input: readonly unknown[], depth: number, budget: { remaining: number }): JsonValue {
	if (Object.getPrototypeOf(input) !== Array.prototype) throw new ExpressionError("invalid-input");
	const length: unknown = Object.getOwnPropertyDescriptor(input, "length")?.value;
	if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > LIMITS.nodes)
		throw new ExpressionError("limit");
	if (Reflect.ownKeys(input).length !== length + 1) throw new ExpressionError("invalid-input");
	const output: JsonValue[] = [];
	// Cardinality plus every canonical own index proves there are no holes or extra keys.
	for (let index = 0; index < length; index++)
		output.push(copyValue(ownValue(input, String(index)), depth + 1, budget));
	return Object.freeze(output);
}

function ownValue(input: object, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(input, key);
	if (!descriptor?.enumerable || !("value" in descriptor)) throw new ExpressionError("invalid-input");
	return descriptor.value;
}
