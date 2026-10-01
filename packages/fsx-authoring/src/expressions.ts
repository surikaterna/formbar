import type { Binding, DefinitionProgram, FormDefinitionAdmission } from "@formbar/declarative";
import { parseRef } from "@formbar/expressions";
import { checkKaladaV1DirectLocation, lowerKaladaV1Expression, parseKaladaV1Expression } from "@kalada/syntax";
import type { KaladaDirectLocationBinding, KaladaReferenceBinding, KaladaSyntaxDiagnostic } from "@kalada/syntax";
import { fail } from "./errors.js";
import type { Attribute, Reference, SourceEntry } from "./types.js";

export interface Environment {
	readonly reads: Readonly<Record<string, KaladaReferenceBinding<Reference>>>;
	readonly writes: Readonly<Record<string, KaladaDirectLocationBinding>>;
}
export interface WriterState {
	readonly sources: Record<string, string>;
	readonly locations: Record<string, NonNullable<FormDefinitionAdmission["directLocations"]>[string]>;
}
function source(entry: Attribute, path: string): string {
	if (entry.value.kind !== "guest") fail("GUEST_REQUIRED", path, entry.valueRange);
	return entry.value.source;
}
function reject(problem: KaladaSyntaxDiagnostic | undefined, entry: Attribute, path: string): never {
	const range = problem && {
		start: entry.valueRange.start + problem.range.start,
		end: entry.valueRange.start + problem.range.end,
	};
	return fail(problem?.code ?? "INVALID_GUEST", appendPath(path, problem?.path ?? []), range, problem?.message);
}
export function read(
	entry: Attribute,
	path: string,
	environment: Environment,
	map: SourceEntry[],
	expected?: string,
): DefinitionProgram {
	const parsed = parseKaladaV1Expression(source(entry, path));
	const lowered = lowerKaladaV1Expression(parsed, {
		references: environment.reads,
		coreOptions: { reference: { validate: reference } },
	});
	if (!lowered.ok) reject(lowered.diagnostics[0], entry, path);
	const type = lowered.resultType;
	if (
		expected &&
		expected !== "json" &&
		(type === "dynamic" ||
			type.kind !== "primitive-type" ||
			type.name !== (expected === "integer" ? "number" : expected))
	)
		fail("PROP_TYPE_MISMATCH", path, entry.valueRange);
	map.push({ path, range: entry.valueRange });
	for (const part of lowered.sourceMap)
		map.push({
			path: appendPath(path, part.path),
			range: { start: entry.valueRange.start + part.range.start, end: entry.valueRange.start + part.range.end },
		});
	return lowered.program;
}
function reference(value: unknown): value is Reference {
	try {
		const parsed = parseRef(value);
		return ["data", "ui", "form", "field"].includes(parsed.namespace);
	} catch {
		return false;
	}
}
export function appendPath(base: string, parts: readonly (string | number)[]): string {
	return parts.reduce<string>(
		(path, part) => (typeof part === "number" ? `${path}[${part}]` : `${path}.${part}`),
		base,
	);
}
export function direct(
	entry: Attribute,
	path: string,
	environment: Environment,
	map: SourceEntry[],
): Binding & { readonly namespace: "data" } {
	const checked = checkKaladaV1DirectLocation(source(entry, path), { bindings: environment.writes });
	if (!checked.ok) reject(checked.diagnostics[0], entry, path);
	const target = checked.location.target;
	map.push({ path, range: entry.valueRange });
	return { namespace: "data", segments: [...target.segments], ...(target.scope ? { scope: target.scope } : {}) };
}
export function recordWriter(entry: Attribute, path: string, environment: Environment, writers: WriterState): void {
	writers.sources[path] = source(entry, path);
	const checked = checkKaladaV1DirectLocation(writers.sources[path], { bindings: environment.writes });
	if (!checked.ok) reject(checked.diagnostics[0], entry, path);
	const { target, type } = checked.location;
	if (target.scope && target.segments.length === 0 && type.kind === "primitive-type") {
		const name = type.name;
		if (name === "string" || name === "number" || name === "boolean") {
			// Legacy evidence shares the binding map; a valid authoring alias must not collide with its key.
			const collision = Object.hasOwn(environment.writes, "primitiveItem");
			const bindings: Record<string, KaladaDirectLocationBinding> = collision
				? { item: { target, type, writable: true } }
				: { ...environment.writes };
			if (collision) writers.sources[path] = "item";
			writers.locations[path] = Object.assign(bindings, {
				primitiveItem: { scope: target.scope, type: name, writable: true as const },
			});
			return;
		}
	}
	writers.locations[path] = { ...environment.writes };
}
