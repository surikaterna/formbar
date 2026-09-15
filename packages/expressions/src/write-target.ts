import type { Segment } from "./contracts.js";
import { ExpressionError } from "./result.js";

const MAX_ARRAY_INDEX = 2 ** 32 - 2;
const CANONICAL_INDEX = /^(?:0|[1-9][0-9]*)$/;

function arrayIndex(segment: Segment): number {
	if (typeof segment === "number") {
		if (!Number.isInteger(segment) || segment < 0 || segment > MAX_ARRAY_INDEX || Object.is(segment, -0)) {
			throw new ExpressionError("denied");
		}
		return segment;
	}
	if (!CANONICAL_INDEX.test(segment)) throw new ExpressionError("denied");
	const index = Number(segment);
	if (!Number.isInteger(index) || index > MAX_ARRAY_INDEX) throw new ExpressionError("denied");
	return index;
}

function validateDenseArray(input: readonly unknown[]): void {
	if (Object.getPrototypeOf(input) !== Array.prototype) throw new ExpressionError("denied");
	const length = Object.getOwnPropertyDescriptor(input, "length")?.value;
	if (typeof length !== "number" || !Number.isInteger(length) || length < 0 || length > 2 ** 32 - 1) {
		throw new ExpressionError("denied");
	}
	const keys = Reflect.ownKeys(input);
	if (keys.length !== length + 1) throw new ExpressionError("denied");
	for (let index = 0; index < length; index++) {
		const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
		if (!descriptor?.enumerable || !("value" in descriptor)) throw new ExpressionError("denied");
	}
}

function targetDescriptor(parent: object, segment: Segment, final: boolean): PropertyDescriptor | undefined {
	if (!Array.isArray(parent)) return Object.getOwnPropertyDescriptor(parent, segment);
	validateDenseArray(parent);
	const index = arrayIndex(segment);
	if (index > parent.length || (!final && index === parent.length)) throw new ExpressionError("missing");
	return index === parent.length ? undefined : Object.getOwnPropertyDescriptor(parent, String(index));
}

/** Validates an immutable write path without reading properties through accessors. */
export function validateWriteTarget(root: unknown, segments: readonly Segment[]): object {
	if (!segments.length) throw new ExpressionError("read-only");
	let current = root;
	for (let index = 0; index < segments.length; index++) {
		if (current === null || typeof current !== "object") throw new ExpressionError("missing");
		const final = index === segments.length - 1;
		const descriptor = targetDescriptor(current, segments[index], final);
		if (!descriptor) {
			if (final && !Array.isArray(current)) return current;
			if (final && Array.isArray(current)) return current;
			throw new ExpressionError("missing");
		}
		if (!("value" in descriptor)) throw new ExpressionError("denied");
		if (final) return current;
		current = descriptor.value;
	}
	throw new ExpressionError("missing");
}
