import type { JsonValue } from "@formbar/expressions";
import { ProgramAdmissionError } from "./kalada-program.js";
import { type ScopeDeclaration, type StaticReference, resolveStaticReference } from "./static-references.js";

export type RecordValue = Record<string, JsonValue>;
export const nodeKeys: Readonly<Record<string, readonly string[]>> = {
	group: ["label", "children"],
	section: ["title", "description", "children"],
	field: ["binding", "widget", "label", "required", "props", "submitWhenHidden"],
	repeater: ["binding", "scope", "label", "children", "minItems", "maxItems"],
	action: ["action", "label", "payload", "concurrency", "target", "props"],
	output: ["value", "label", "format", "props"],
	conditional: ["condition", "then", "else"],
	tabs: ["tabs"],
	accordion: ["items"],
	validation: ["binding", "messages"],
	custom: ["renderer", "props", "children"],
};
const baseKeys = ["id", "type", "visible", "disabled", "readOnly", "presentation"];
const unsafe = new Set(["__proto__", "constructor", "prototype"]);

export function object(value: JsonValue | undefined, path: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new ProgramAdmissionError(path, "INVALID_SHAPE");
	return value as RecordValue;
}

export function list(value: JsonValue | undefined, path: string): JsonValue[] {
	if (!Array.isArray(value)) throw new ProgramAdmissionError(path, "INVALID_SHAPE");
	return value;
}

export function identifier(value: JsonValue | undefined, path: string): string {
	if (typeof value !== "string" || !value || value.length > 256 || unsafe.has(value))
		throw new ProgramAdmissionError(path, "INVALID_ID");
	return value;
}

export function exact(source: RecordValue, allowed: readonly string[], path: string): void {
	for (const key of Object.keys(source))
		if (!allowed.includes(key)) throw new ProgramAdmissionError(`${path}.${key}`, "UNKNOWN_KEY");
}

export function nodeShape(source: RecordValue, path: string): string {
	const type = source.type;
	if (typeof type !== "string" || !Object.hasOwn(nodeKeys, type))
		throw new ProgramAdmissionError(`${path}.type`, "UNKNOWN_NODE_TYPE");
	exact(source, [...baseKeys, ...(nodeKeys[type] ?? [])], path);
	return type;
}

export function directReference(
	value: JsonValue | undefined,
	path: string,
	scopes: Readonly<Record<string, ScopeDeclaration>>,
	enclosing?: string,
): StaticReference {
	try {
		const source = object(value, path);
		if (source.namespace !== "data" && source.namespace !== "ui") throw new Error("invalid target namespace");
		return resolveStaticReference(source, scopes, enclosing);
	} catch {
		throw new ProgramAdmissionError(path, "INVALID_BINDING");
	}
}

export function scopeDeclaration(
	value: JsonValue | undefined,
	path: string,
	scopes: Readonly<Record<string, ScopeDeclaration>>,
	enclosing?: string,
): ScopeDeclaration {
	const source = object(value, path);
	const ref = directReference(source, path, scopes, enclosing);
	if (!Array.isArray(source.segments) || !source.segments.length)
		throw new ProgramAdmissionError(path, "INVALID_BINDING");
	if (source.scope !== enclosing || (enclosing && scopes[enclosing]?.namespace !== ref.namespace))
		throw new ProgramAdmissionError(path, "INVALID_BINDING");
	return {
		namespace: ref.namespace as "data" | "ui",
		segments: source.segments as (string | number)[],
		...(enclosing === undefined ? {} : { parent: enclosing }),
	};
}
