import { type ValidatedFormDefinition, validateFormDefinition } from "@formbar/declarative";
import { FsxError, fail } from "./errors.js";
import { appendPath } from "./expressions.js";
import { FsxLowerer } from "./lower.js";
import { FsxParser } from "./parser.js";
import type { FsxCompileOptions, FsxCompileResult, SourceEntry } from "./types.js";
export type {
	FsxCompileOptions,
	FsxCompileResult,
	FsxDiagnostic,
	FsxDiagnosticLocation,
	Reference,
	RendererDescriptor,
	SourceEntry,
	SourceRange,
} from "./types.js";

function rejectAccessors(value: unknown, seen = new Set<object>(), depth = 0): void {
	if (typeof value !== "object" || value === null || seen.has(value)) return;
	if (depth > 40 || seen.size > 4000) fail("METADATA_LIMIT", "root");
	seen.add(value);
	const prototype: unknown = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== Array.prototype) rejectAccessors(prototype, seen, depth + 1);
	for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
		if (!("value" in descriptor)) fail("ACCESSOR_METADATA", "root");
		rejectAccessors(descriptor.value, seen, depth + 1);
	}
}
function success(validated: ValidatedFormDefinition, map: SourceEntry[]): FsxCompileResult {
	const { prepared: _prepared, ...definition } = validated;
	return { ok: true, definition, validated, sourceMap: Object.freeze(map) };
}
/** Authoring only: installed identity metadata may be inspected, but no computation is evaluated. */
export function compileFsx(source: string, options: FsxCompileOptions): FsxCompileResult {
	try {
		rejectAccessors(options);
		if (options.profile !== "fsx-v1-experimental") fail("UNKNOWN_PROFILE", "root");
		const lowerer = new FsxLowerer(options);
		const definition = lowerer.lower(new FsxParser(source).parse());
		const admission = {
			...options.admission,
			writeSources: lowerer.writers.sources,
			directLocations: lowerer.writers.locations,
		};
		const validated = validateFormDefinition(definition, admission);
		if (!validated.ok)
			return {
				ok: false,
				diagnostics: validated.diagnostics.map((problem) => {
					const path = appendPath("", problem.path).replace(/^\./u, "");
					const range = lowerer.map.find((entry) => entry.path === path)?.range;
					return { code: problem.code, message: problem.message, path, ...(range ? { range } : {}) };
				}),
			};
		return success(validated.value, lowerer.map);
	} catch (error) {
		if (error instanceof FsxError) return { ok: false, diagnostics: [error.diagnostic] };
		return {
			ok: false,
			diagnostics: [
				{
					code: "COMPILER_INPUT_INVALID",
					message: "Invalid trusted compiler installation or source; no definition emitted",
					path: "root",
				},
			],
		};
	}
}
