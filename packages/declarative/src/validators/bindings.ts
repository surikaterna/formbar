import type { JsonValue, Scopes, Segment } from "@formbar/expressions";
import type { Binding } from "../bindings.js";
import type { DiagnosticPathSegment } from "../diagnostics.js";
import { type ValidationContext, diagnostic } from "./context.js";
import { expression } from "./expressions.js";
import { exactKeys, identifier, record } from "./shape.js";

export function binding(
	value: JsonValue | undefined,
	path: readonly DiagnosticPathSegment[],
	scopes: Scopes,
	context: ValidationContext,
): Binding | undefined {
	if (value === undefined) {
		diagnostic(context, "required", path, "Expected a binding.");
		return undefined;
	}
	const source = record(value, path, context);
	if (!source) return undefined;
	exactKeys(source, new Set(["namespace", "segments", "scope"]), path, context);
	const namespace = identifier(source.namespace, [...path, "namespace"], context);
	const segments = bindingSegments(source.segments, [...path, "segments"], context);
	const scope = source.scope === undefined ? undefined : identifier(source.scope, [...path, "scope"], context);
	if (scope && !Object.hasOwn(scopes, scope))
		diagnostic(context, "unknown-scope", [...path, "scope"], `Unknown scope '${scope}'.`);
	if (!namespace || !segments || (source.scope !== undefined && !scope)) return undefined;
	const output = Object.freeze({ namespace, segments, ...(scope ? { scope } : {}) }) as Binding;
	if (scope && !Object.hasOwn(scopes, scope)) return undefined;
	return expression({ kind: "ref", ref: output }, path, scopes, context) ? output : undefined;
}

function bindingSegments(
	value: JsonValue | undefined,
	path: readonly DiagnosticPathSegment[],
	context: ValidationContext,
): readonly Segment[] | undefined {
	if (!Array.isArray(value) || value.length > 64) {
		diagnostic(context, "invalid-binding", path, "Expected at most 64 structured path segments.");
		return undefined;
	}
	const segments: Segment[] = [];
	for (let index = 0; index < value.length; index++) {
		const segment = value[index];
		if (validSegment(segment)) segments.push(segment);
		else
			diagnostic(
				context,
				"invalid-binding",
				[...path, index],
				"Expected a safe string or non-negative integer segment.",
			);
	}
	return segments.length === value.length ? Object.freeze(segments) : undefined;
}

const validSegment = (value: JsonValue): value is Segment =>
	typeof value === "number"
		? Number.isSafeInteger(value) && value >= 0
		: typeof value === "string" && value.length > 0 && !["__proto__", "constructor", "prototype"].includes(value);
