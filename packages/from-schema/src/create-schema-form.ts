import { createDeferredForm, createForm } from "@formbar/core";
import type { CreateFormOptions, SchemaValidator } from "@formbar/core";
import { assertScopedAsyncIds, registerScopedAsync, registerScopedSync } from "@formbar/core/internal/scoped-sync";
import {
	type DefinitionAsyncFieldValidator,
	type DefinitionDiagnostic,
	type DefinitionFieldValidator,
	type FormDefinition,
	type RuntimeFieldBaseline,
	type RuntimeRepeaterBaseline,
	type ValidatedFormDefinition,
	validateFormDefinition,
} from "@formbar/declarative";
import { prepareScopedAsyncHost, prepareScopedSyncHost } from "@formbar/declarative/internal/scoped-sync";
import type { LimitOptions, SchemaDocumentProvider, StandardSchemaV1 } from "@scheman/core";
import {
	type CompileDefaultFormDefinitionOptions,
	compileDefaultFormDefinition,
} from "./compiler/compile-default-definition.js";
import type { DescriptorDocument, DescriptorSide } from "./descriptors/contracts.js";
import type { ProjectionLimitOptions } from "./descriptors/limits.js";
import type { SchemaFormDiagnostics } from "./diagnostics.js";
import { prepareJsonSchema } from "./json-schema-validator.js";
import { isJsonProvider, isSupportedJsonProvider } from "./providers/json-schema-provider.js";
import { adaptRuntimeFieldBaseline } from "./runtime-baseline.js";
import { projectSchema } from "./schema-source.js";

export interface CreateSchemaFormOptions<TData = unknown, TUi = unknown> {
	readonly provider: SchemaDocumentProvider;
	readonly side: DescriptorSide;
	readonly limits?: LimitOptions;
	readonly projectionLimits?: ProjectionLimitOptions;
	readonly validators?: readonly SchemaValidator<TData, TUi>[];
	readonly definition?: FormDefinition;
	readonly generation?: CompileDefaultFormDefinitionOptions;
	/** V1 definition FieldNode IDs only; never data paths or concrete row identities. */
	readonly fieldValidators?: readonly DefinitionFieldValidator<TData, TUi>[];
	readonly asyncFieldValidators?: readonly DefinitionAsyncFieldValidator<TData, TUi>[];
}

export interface SchemaFormResult<TData = unknown, TUi = unknown> {
	readonly descriptors: DescriptorDocument;
	readonly definition: ValidatedFormDefinition;
	readonly baseline: readonly RuntimeFieldBaseline[];
	readonly repeaterBaseline: readonly RuntimeRepeaterBaseline[];
	readonly sourceValidator?: StandardSchemaV1;
	readonly validators: readonly SchemaValidator<TData, TUi>[];
	readonly diagnostics: SchemaFormDiagnostics;
	readonly createForm: (options: CreateFormOptions<TData, TUi>) => ReturnType<typeof createForm<TData, TUi>>;
	readonly createDeferredForm: (
		options: CreateFormOptions<TData, TUi>,
	) => ReturnType<typeof createDeferredForm<TData, TUi>>;
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
	const validation = isJsonProvider(options.provider)
		? prepareJsonSchema(schema, isSupportedJsonProvider(options.provider))
		: undefined;
	const projectionOptions = {
		provider: options.provider,
		side: options.side,
		...(options.limits ? { limits: options.limits } : {}),
		...(options.projectionLimits ? { projectionLimits: options.projectionLimits } : {}),
	};
	const unsafeProjection =
		validation?.diagnostics[0]?.code === "non-plain-schema" || validation?.diagnostics[0]?.code === "schema-limit";
	let projected: ReturnType<typeof projectSchema>;
	try {
		projected = projectSchema(unsafeProjection ? {} : schema, projectionOptions);
	} catch (error) {
		if (!validation?.diagnostics.length) throw error;
		projected = projectSchema({}, projectionOptions);
	}
	const prepared = options.definition
		? validateAuthoredDefinition(options.definition, projected.descriptors)
		: compileDefaultFormDefinition(projected.descriptors, options.generation);
	if (!prepared.definition) throw new InvalidFormDefinitionError(prepared.definitionDiagnostics);
	const scoped = options.fieldValidators
		? prepareScopedSyncHost(prepared.definition, options.fieldValidators)
		: undefined;
	const scopedAsync = options.asyncFieldValidators
		? prepareScopedAsyncHost(prepared.definition, options.asyncFieldValidators)
		: undefined;
	const preflight = (coreOptions: CreateFormOptions<TData, TUi>) => {
		if (scopedAsync)
			assertScopedAsyncIds(
				scopedAsync,
				(coreOptions.asyncValidators ?? []).map((entry) => entry.id),
			);
	};
	const attach = (form: ReturnType<typeof createForm<TData, TUi>>, coreOptions: CreateFormOptions<TData, TUi>) => {
		if (scoped) registerScopedSync(form, scoped);
		if (scopedAsync)
			registerScopedAsync(
				form,
				scopedAsync,
				(coreOptions.asyncValidators ?? []).map((entry) => entry.id),
			);
		return form;
	};
	return Object.freeze({
		createForm: (coreOptions: CreateFormOptions<TData, TUi>) => {
			preflight(coreOptions);
			return attach(createForm(coreOptions), coreOptions);
		},
		createDeferredForm: (coreOptions: CreateFormOptions<TData, TUi>) => {
			preflight(coreOptions);
			const runtime = createDeferredForm(coreOptions);
			attach(runtime.form, coreOptions);
			return runtime;
		},
		descriptors: projected.descriptors,
		definition: prepared.definition,
		baseline: prepared.baseline,
		repeaterBaseline: prepared.repeaterBaseline,
		...(projected.validator ? { sourceValidator: projected.validator } : {}),
		validators: Object.freeze([
			...(validation ? [validation.validator as SchemaValidator<TData, TUi>] : []),
			...(options.validators ?? []),
		]),
		diagnostics: Object.freeze({
			validation: validation?.diagnostics ?? Object.freeze([]),
			source: projected.descriptors.sourceDiagnostics,
			projection: projected.descriptors.projectionDiagnostics,
			compilation: prepared.diagnostics,
			definition: prepared.definitionDiagnostics,
		}),
	});
}

function validateAuthoredDefinition(definition: FormDefinition, document: DescriptorDocument) {
	const validation = validateFormDefinition(definition);
	if (!validation.ok)
		return {
			definition: undefined,
			baseline: Object.freeze([]),
			repeaterBaseline: Object.freeze([]),
			diagnostics: Object.freeze([]),
			definitionDiagnostics: validation.diagnostics,
		};
	const adapted = adaptRuntimeFieldBaseline(document, validation.value);
	return {
		definition: validation.value,
		baseline: adapted.baseline,
		repeaterBaseline: adapted.repeaterBaseline,
		diagnostics: adapted.diagnostics,
		definitionDiagnostics: Object.freeze([]),
	};
}

export class InvalidFormDefinitionError extends TypeError {
	readonly diagnostics: readonly DefinitionDiagnostic[];

	constructor(diagnostics: readonly DefinitionDiagnostic[]) {
		super("Form definition validation failed.");
		this.name = "InvalidFormDefinitionError";
		this.diagnostics = diagnostics;
	}
}
