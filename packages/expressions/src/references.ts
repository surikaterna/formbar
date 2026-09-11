import type { JsonValue, Scopes, Segment, StateRef } from "./contracts.js";
import { LIMITS, copyJson, safeName } from "./json.js";
import { ExpressionError } from "./result.js";
import { exactKeys, isJsonArray, jsonRecord } from "./shape.js";

const isSegment = (value: JsonValue): value is Segment =>
	typeof value === "number" ? Number.isSafeInteger(value) && value >= 0 : safeName(value);

export function parseRef(input: JsonValue): StateRef {
	const ref = jsonRecord(input);
	exactKeys(ref, ["namespace", "segments", "scope"]);
	if (!safeName(ref.namespace) || (Object.hasOwn(ref, "scope") && !safeName(ref.scope)))
		throw new ExpressionError("invalid-input");
	if (!Object.hasOwn(ref, "segments") || !isJsonArray(ref.segments)) throw new ExpressionError("invalid-input");
	if (ref.segments.length > LIMITS.segments) throw new ExpressionError("limit");
	if (!ref.segments.every(isSegment)) throw new ExpressionError("invalid-input");
	const scope = ref.scope;
	return Object.freeze({
		namespace: ref.namespace,
		segments: Object.freeze([...ref.segments]),
		...(safeName(scope) ? { scope } : {}),
	});
}

export function parseScopes(input: unknown): Scopes {
	const record = jsonRecord(copyJson(input));
	const scopes: Record<string, StateRef> = Object.create(null);
	for (const [name, value] of Object.entries(record)) {
		if (!safeName(name)) throw new ExpressionError("invalid-input");
		scopes[name] = parseRef(value);
	}
	return Object.freeze(scopes);
}

export function validateRef(ref: StateRef): void {
	parseRef(copyJson(ref));
}

export function resolveRef(ref: StateRef, scopes: Scopes = {}, seen = new Set<string>()): StateRef {
	validateRef(ref);
	if (!ref.scope) return Object.freeze({ namespace: ref.namespace, segments: Object.freeze([...ref.segments]) });
	if (seen.has(ref.scope) || seen.size >= LIMITS.depth) throw new ExpressionError("invalid-input");
	seen.add(ref.scope);
	const descriptor = Object.getOwnPropertyDescriptor(scopes, ref.scope);
	if (!descriptor || !("value" in descriptor)) throw new ExpressionError("invalid-input");
	const scope = parseRef(copyJson(descriptor.value));
	if (scope.namespace !== ref.namespace) throw new ExpressionError("invalid-input");
	const parent = resolveRef(scope, scopes, seen);
	return resolveRef({ namespace: ref.namespace, segments: [...parent.segments, ...ref.segments] });
}

export const dependencyKey = (ref: StateRef): string => JSON.stringify([ref.namespace, ref.segments.map(String)]);

export function readOwn(root: unknown, segments: readonly Segment[]): unknown {
	let current = root;
	for (const segment of segments) {
		if (current === null || typeof current !== "object") throw new ExpressionError("missing");
		const descriptor = Object.getOwnPropertyDescriptor(current, segment);
		if (!descriptor) throw new ExpressionError("missing");
		if (!("value" in descriptor)) throw new ExpressionError("denied");
		current = descriptor.value;
	}
	if (current === undefined) throw new ExpressionError("missing");
	return current;
}
