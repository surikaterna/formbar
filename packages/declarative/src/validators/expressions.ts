import { createExpressionService } from "@formbar/expressions";
import type { Expression, JsonValue, Program, PropDefinitions, Scopes } from "@formbar/expressions";
import type { DiagnosticPathSegment } from "../diagnostics.js";
import { type ValidationContext, diagnostic } from "./context.js";
import { exactKeys, identifier, record } from "./shape.js";

export interface ValidatedExpression {
	readonly expression: Expression;
	readonly program: Program;
}

export function expression(
	value: JsonValue | undefined,
	path: readonly DiagnosticPathSegment[],
	scopes: Scopes,
	context: ValidationContext,
): ValidatedExpression | undefined {
	if (value === undefined) {
		diagnostic(context, "required", path, "Expected an expression.");
		return undefined;
	}
	const result = createExpressionService({ scopes }).compile(value);
	if (!result.ok) {
		diagnostic(
			context,
			"invalid-expression",
			path,
			`Invalid expression (${result.diagnostics[0]?.code ?? "backend"}).`,
		);
		return undefined;
	}
	return Object.freeze({ expression: value as Expression, program: result.value });
}

export function props(
	value: JsonValue | undefined,
	path: readonly DiagnosticPathSegment[],
	scopes: Scopes,
	context: ValidationContext,
): PropDefinitions | undefined {
	if (value === undefined) return undefined;
	const source = record(value, path, context);
	if (!source) return undefined;
	const output: Record<string, PropDefinitions[string]> = Object.create(null);
	for (const [name, spec] of Object.entries(source)) {
		const propPath = [...path, name];
		if (!identifier(name, propPath, context)) continue;
		const parsed = prop(spec, propPath, scopes, context);
		if (parsed) output[name] = parsed;
	}
	return Object.freeze(output);
}

function prop(
	value: JsonValue,
	path: readonly DiagnosticPathSegment[],
	scopes: Scopes,
	context: ValidationContext,
): PropDefinitions[string] | undefined {
	const source = record(value, path, context);
	if (!source) return undefined;
	const mode = source.mode;
	if (mode === "literal") return literalProp(source, path, context);
	if (mode === "read" || mode === "write") return expressionProp(source, path, scopes, context, mode);
	diagnostic(context, "invalid-type", [...path, "mode"], "Expected prop mode 'literal', 'read', or 'write'.");
	return undefined;
}

function literalProp(
	source: Readonly<Record<string, JsonValue>>,
	path: readonly DiagnosticPathSegment[],
	context: ValidationContext,
): PropDefinitions[string] | undefined {
	exactKeys(source, new Set(["mode", "value"]), path, context);
	if (!Object.hasOwn(source, "value")) {
		diagnostic(context, "required", [...path, "value"], "Expected a literal value.");
		return undefined;
	}
	return Object.freeze({ mode: "literal", value: source.value as JsonValue });
}

function expressionProp(
	source: Readonly<Record<string, JsonValue>>,
	path: readonly DiagnosticPathSegment[],
	scopes: Scopes,
	context: ValidationContext,
	mode: "read" | "write",
): PropDefinitions[string] | undefined {
	exactKeys(source, new Set(["mode", "expression"]), path, context);
	const parsed = expression(source.expression, [...path, "expression"], scopes, context);
	if (!parsed) return undefined;
	if (mode === "write" && parsed.expression.kind !== "ref") {
		diagnostic(context, "invalid-expression", [...path, "expression"], "Writable props require a direct reference.");
		return undefined;
	}
	return Object.freeze({ mode, expression: parsed.expression }) as PropDefinitions[string];
}
