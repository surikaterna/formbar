import type { SchemaValidator } from "@formbar/core";
import {
	type DefinitionDiagnostic,
	type FormDefinition,
	type ValidatedFormDefinition,
	validateFormDefinition,
} from "@formbar/declarative";
import type { LimitOptions, SchemaDocumentProvider, StandardSchemaV1 } from "@scheman/core";
import {
	type CompileDefaultFormDefinitionOptions,
	compileDefaultFormDefinition,
} from "./compiler/compile-default-definition.js";
import type { DescriptorDocument, DescriptorSide } from "./descriptors/contracts.js";
import type { ProjectionLimitOptions } from "./descriptors/limits.js";
import type { SchemaFormDiagnostics } from "./diagnostics.js";
import { projectSchema } from "./schema-source.js";

export interface CreateSchemaFormOptions<TData = unknown, TUi = unknown> {
	readonly provider: SchemaDocumentProvider;
	readonly side: DescriptorSide;
	readonly limits?: LimitOptions;
	readonly projectionLimits?: ProjectionLimitOptions;
	readonly validators?: readonly SchemaValidator<TData, TUi>[];
	readonly definition?: FormDefinition;
	readonly generation?: CompileDefaultFormDefinitionOptions;
}

export interface SchemaFormResult<TData = unknown, TUi = unknown> {
	readonly descriptors: DescriptorDocument;
	readonly definition: ValidatedFormDefinition;
	readonly sourceValidator?: StandardSchemaV1;
	readonly validators: readonly SchemaValidator<TData, TUi>[];
	readonly diagnostics: SchemaFormDiagnostics;
}

/**
 * Projects one explicitly selected schema side and validates either an authored
 * definition or a deterministic generated definition. It does not render.
 */
export function createSchemaForm<TData = unknown, TUi = unknown>(
	schema: unknown,
	options: CreateSchemaFormOptions<TData, TUi>,
): SchemaFormResult<TData, TUi> {
	if (options.definition && options.generation) {
		throw new TypeError("definition and generation are mutually exclusive.");
	}
	const projected = projectSchema(schema, {
		provider: options.provider,
		side: options.side,
		...(options.limits ? { limits: options.limits } : {}),
		...(options.projectionLimits ? { projectionLimits: options.projectionLimits } : {}),
	});
	const prepared = options.definition
		? validateAuthoredDefinition(options.definition)
		: compileDefaultFormDefinition(projected.descriptors, options.generation);
	if (!prepared.definition) throw new InvalidFormDefinitionError(prepared.definitionDiagnostics);
	return Object.freeze({
		descriptors: projected.descriptors,
		definition: prepared.definition,
		...(projected.validator ? { sourceValidator: projected.validator } : {}),
		validators: Object.freeze([...(options.validators ?? [])]),
		diagnostics: Object.freeze({
			source: projected.descriptors.sourceDiagnostics,
			projection: projected.descriptors.projectionDiagnostics,
			compilation: prepared.diagnostics,
			definition: prepared.definitionDiagnostics,
		}),
	});
}

function validateAuthoredDefinition(definition: FormDefinition) {
	const validation = validateFormDefinition(definition);
	return validation.ok
		? { definition: validation.value, diagnostics: Object.freeze([]), definitionDiagnostics: Object.freeze([]) }
		: { definition: undefined, diagnostics: Object.freeze([]), definitionDiagnostics: validation.diagnostics };
}

export class InvalidFormDefinitionError extends TypeError {
	readonly diagnostics: readonly DefinitionDiagnostic[];

	constructor(diagnostics: readonly DefinitionDiagnostic[]) {
		super("Form definition validation failed.");
		this.name = "InvalidFormDefinitionError";
		this.diagnostics = diagnostics;
	}
}
