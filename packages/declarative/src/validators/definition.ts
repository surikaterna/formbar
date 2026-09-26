import { copyJson } from "@formbar/expressions";
import type { JsonValue } from "@formbar/expressions";
import type { FormDefinition, ValidatedFormDefinition } from "../definition.js";
import { type DefinitionValidationResult, sortDiagnostics } from "../diagnostics.js";
import { computations } from "./computations.js";
import { type ValidationContext, diagnostic } from "./context.js";
import { node } from "./nodes.js";
import { exactKeys, identifier, record } from "./shape.js";

export function validateFormDefinition(input: unknown): DefinitionValidationResult<ValidatedFormDefinition> {
	const context: ValidationContext = { diagnostics: [], nodeIds: new Map(), scopeIds: new Map() };
	const safe = safeInput(input, context);
	if (safe === undefined) return failure(context);
	const source = record(safe, [], context);
	if (!source) return failure(context);
	exactKeys(source, new Set(["version", "id", "root", "computations", "submission"]), [], context);
	const version = definitionVersion(source.version, context);
	const id = identifier(source.id, ["id"], context);
	const root = node(source.root, ["root"], { ...context, scopes: Object.freeze({}) });
	const stored = computations(source.computations, ["computations"], context);
	const submission = submissionPolicy(source.submission, context);
	if (context.diagnostics.length || version === undefined || !id || !root) return failure(context);
	const value: ValidatedFormDefinition = Object.freeze({
		version,
		id,
		root,
		...(stored === undefined ? {} : { computations: stored }),
		...(submission === undefined ? {} : { submission }),
	});
	return Object.freeze({ ok: true, value });
}

function submissionPolicy(value: JsonValue | undefined, context: ValidationContext): FormDefinition["submission"] {
	if (value === undefined) return undefined;
	const source = record(value, ["submission"], context);
	if (!source) return undefined;
	exactKeys(source, new Set(["hiddenValues"]), ["submission"], context);
	if (source.hiddenValues === "include" || source.hiddenValues === "omit-inactive")
		return Object.freeze({ hiddenValues: source.hiddenValues });
	diagnostic(
		context,
		source.hiddenValues === undefined ? "required" : "invalid-type",
		["submission", "hiddenValues"],
		"Expected include or omit-inactive.",
	);
	return undefined;
}

function safeInput(input: unknown, context: ValidationContext): JsonValue | undefined {
	try {
		return copyJson(input);
	} catch {
		diagnostic(context, "invalid-json", [], "Definition must contain only finite JSON data with safe prototypes.");
		return undefined;
	}
}

function definitionVersion(
	value: JsonValue | undefined,
	context: ValidationContext,
): FormDefinition["version"] | undefined {
	if (value === 1) return value;
	if (value === undefined) diagnostic(context, "required", ["version"], "Expected definition version 1.");
	else diagnostic(context, "unsupported-version", ["version"], "Only definition version 1 is supported.");
	return undefined;
}

function failure(context: ValidationContext): DefinitionValidationResult<never> {
	return Object.freeze({ ok: false, diagnostics: sortDiagnostics(context.diagnostics) });
}
