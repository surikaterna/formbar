import { copyJson, parseRef } from "@formbar/expressions";
import type { JsonValue } from "@formbar/expressions";

type Segment = string | number;
type Namespace = "data" | "ui" | "form" | "field";
export type StaticPathPart = Segment | Readonly<{ row: string }>;
export interface StaticReference {
	readonly namespace: Namespace;
	readonly path: readonly StaticPathPart[];
}

// Scope declarations describe repeater bindings, not aliases or concrete row indices.
// A nested declaration's segments are relative to its parent row.
export interface ScopeDeclaration {
	readonly namespace: "data" | "ui";
	readonly segments: readonly Segment[];
	readonly parent?: string;
}

const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);
const FORM_KEYS = new Set(["valid", "validating", "submitting", "dirty", "touched", "submitted"]);
const FIELD_KEYS = new Set(["valid", "validating", "dirty", "touched"]);

function fail(): never {
	throw new TypeError("Invalid static state reference or scope declaration.");
}

function safeString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= 256 && !UNSAFE.has(value);
}

function object(value: JsonValue): Record<string, JsonValue> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
	return value as Record<string, JsonValue>;
}

function keys(value: Record<string, JsonValue>, allowed: readonly string[], required: readonly string[]): void {
	if (Object.keys(value).some((key) => !allowed.includes(key)) || required.some((key) => !Object.hasOwn(value, key)))
		fail();
}

function segments(value: JsonValue): readonly Segment[] {
	if (!Array.isArray(value) || value.length > 64) return fail();
	for (const segment of value) {
		if (typeof segment === "number" ? Number.isSafeInteger(segment) && segment >= 0 : safeString(segment)) continue;
		fail();
	}
	return value as readonly Segment[];
}

function namespace(value: unknown): Namespace {
	if (value === "data" || value === "ui" || value === "form" || value === "field") return value;
	return fail();
}

function declaration(value: JsonValue): ScopeDeclaration {
	const source = object(value);
	keys(source, ["namespace", "segments", "parent"], ["namespace", "segments"]);
	const ns = namespace(source.namespace);
	if (ns !== "data" && ns !== "ui") return fail();
	const path = segments(source.segments);
	if (path.length === 0 || (Object.hasOwn(source, "parent") && !safeString(source.parent))) return fail();
	return { namespace: ns, segments: path, ...(source.parent ? { parent: source.parent as string } : {}) };
}

function scopeChain(name: string, scopes: Record<string, JsonValue>): readonly [string, ScopeDeclaration][] {
	const seen = new Set<string>();
	const chain: [string, ScopeDeclaration][] = [];
	let current: string | undefined = name;
	while (current !== undefined) {
		if (!safeString(current) || seen.has(current) || seen.size >= 32 || !Object.hasOwn(scopes, current)) fail();
		seen.add(current);
		const entry = declaration(scopes[current] as JsonValue);
		chain.unshift([current, entry]);
		current = entry.parent;
	}
	for (let index = 1; index < chain.length; index++) {
		if (chain[index]?.[1].namespace !== chain[index - 1]?.[1].namespace) fail();
	}
	return chain;
}

/** Static check only: the caller supplies the trusted lexical scope map and enclosing scope. */
export function resolveStaticReference(input: unknown, scopeMap: unknown, enclosingScope?: string): StaticReference {
	// copyJson rejects inherited keys, getters, cycles, sparse arrays and non-JSON input without invoking accessors.
	const source = object(copyJson(input));
	// Keep the public codec at the boundary; its scope token and segment types are not flattened.
	parseRef(source);
	const scopes = object(copyJson(scopeMap));
	keys(source, ["namespace", "segments", "scope"], ["namespace", "segments"]);
	const ns = namespace(source.namespace);
	const path = segments(source.segments);
	const scope = source.scope;
	if (Object.hasOwn(source, "scope") && !safeString(scope)) return fail();
	if (ns === "form" || ns === "field") {
		if (scope !== undefined || path.length !== (ns === "form" ? 1 : 2)) fail();
		if (ns === "form" && !FORM_KEYS.has(path[0] as string)) fail();
		if (ns === "field" && (typeof path[0] !== "string" || !FIELD_KEYS.has(path[1] as string))) fail();
	}
	if (enclosingScope !== undefined && !safeString(enclosingScope)) fail();
	const ancestors = enclosingScope === undefined ? [] : scopeChain(enclosingScope, scopes);
	if (scope === undefined) return Object.freeze({ namespace: ns, path: Object.freeze([...path]) });
	if (enclosingScope === undefined || !ancestors.some(([name]) => name === scope)) fail();
	const chain = scopeChain(scope as string, scopes);
	if (chain.some(([, binding]) => binding.namespace !== ns)) fail();
	const absolute: StaticPathPart[] = [];
	for (const [name, binding] of chain) absolute.push(...binding.segments, Object.freeze({ row: name }));
	absolute.push(...path);
	if (absolute.length > 64) fail();
	return Object.freeze({ namespace: ns, path: Object.freeze(absolute) });
}

/** Typed, collision-free graph identity; row placeholders never imply a selected row. */
export function staticDependencyKey(ref: StaticReference): string {
	return JSON.stringify([
		ref.namespace,
		ref.path.map((part) =>
			typeof part === "string" ? ["s", part] : typeof part === "number" ? ["n", part] : ["row", part.row],
		),
	]);
}
