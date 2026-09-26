import { createDeferredForm, createForm } from "@formbar/core";
import type { CreateFormOptions, SchemaValidator } from "@formbar/core";
import { assertScopedAsyncIds, registerScopedAsync, registerScopedSync } from "@formbar/core/internal/scoped-sync";
import { activateBoundSubmit } from "@formbar/core/internal/submit-proof";
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
import { bindOmissionSupplier } from "@formbar/declarative/internal/omission-supplier";
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
	readonly submission?: FormDefinition["submission"];
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
	assertAuthoredSubmission(options.definition, options.submission);
	const validation = isJsonProvider(options.provider)
		? prepareJsonSchema(schema, isSupportedJsonProvider(options.provider))
		: undefined;
	const projected = projectWithValidation(schema, options, validation);
	const prepared = options.definition
		? validateAuthoredDefinition(options.definition, projected.descriptors)
		: compileDefaultFormDefinition(projected.descriptors, options.generation, options.submission);
	if (!prepared.definition) throw new InvalidFormDefinitionError(prepared.definitionDiagnostics);
	const validators = Object.freeze([
		...(validation ? [validation.validator as SchemaValidator<TData, TUi>] : []),
		...(options.validators ?? []),
	]);
	const factories = createPreparedFactories(prepared.definition, options, validators);
	return Object.freeze({
		...factories,
		descriptors: projected.descriptors,
		definition: prepared.definition,
		baseline: prepared.baseline,
		repeaterBaseline: prepared.repeaterBaseline,
		...(projected.validator ? { sourceValidator: projected.validator } : {}),
		validators,
		diagnostics: Object.freeze({
			validation: validation?.diagnostics ?? Object.freeze([]),
			source: projected.descriptors.sourceDiagnostics,
			projection: projected.descriptors.projectionDiagnostics,
			compilation: prepared.diagnostics,
			definition: prepared.definitionDiagnostics,
		}),
	});
}

function assertAuthoredSubmission(
	definition: FormDefinition | undefined,
	submission: FormDefinition["submission"],
): void {
	if (!definition || submission === undefined) return;
	const validated = validateFormDefinition({ ...definition, submission });
	if (!validated.ok) throw new InvalidFormDefinitionError(validated.diagnostics);
	if (definition.submission?.hiddenValues !== validated.value.submission?.hiddenValues) {
		throw new TypeError("Authored definition submission policy conflicts with the supplied option.");
	}
}

function projectWithValidation(
	schema: unknown,
	options: Pick<CreateSchemaFormOptions, "provider" | "side" | "limits" | "projectionLimits">,
	validation: ReturnType<typeof prepareJsonSchema> | undefined,
): ReturnType<typeof projectSchema> {
	const projectionOptions = {
		provider: options.provider,
		side: options.side,
		...(options.limits ? { limits: options.limits } : {}),
		...(options.projectionLimits ? { projectionLimits: options.projectionLimits } : {}),
	};
	const unsafeProjection =
		validation?.diagnostics[0]?.code === "non-plain-schema" || validation?.diagnostics[0]?.code === "schema-limit";
	try {
		return projectSchema(unsafeProjection ? {} : schema, projectionOptions);
	} catch (error) {
		if (!validation?.diagnostics.length) throw error;
		return projectSchema({}, projectionOptions);
	}
}

function createPreparedFactories<TData, TUi>(
	definition: ValidatedFormDefinition,
	options: CreateSchemaFormOptions<TData, TUi>,
	validators: readonly SchemaValidator<TData, TUi>[],
) {
	const scoped = options.fieldValidators ? prepareScopedSyncHost(definition, options.fieldValidators) : undefined;
	const scopedAsync = options.asyncFieldValidators
		? prepareScopedAsyncHost(definition, options.asyncFieldValidators)
		: undefined;
	const omission = definition.submission?.hiddenValues === "omit-inactive";
	const withValidators = (coreOptions: CreateFormOptions<TData, TUi>): CreateFormOptions<TData, TUi> => ({
		...coreOptions,
		validators: [...validators, ...(coreOptions.validators ?? [])],
		...(scopedAsync || omission ? { ownedScheduling: true } : {}),
	});
	const attach = (form: ReturnType<typeof createForm<TData, TUi>>, coreOptions: CreateFormOptions<TData, TUi>) =>
		attachPrepared(form, coreOptions, definition, scoped, scopedAsync, omission);
	return {
		createForm: (coreOptions: CreateFormOptions<TData, TUi>) => {
			preflightPrepared(coreOptions, validators, scopedAsync);
			if (!omission) return attach(createForm(withValidators(coreOptions)), coreOptions);
			const runtime = createDeferredForm(withValidators(coreOptions));
			try {
				attach(runtime.form, coreOptions);
				runtime.activate();
				return runtime.form;
			} catch (error) {
				runtime.form.dispose();
				throw error;
			}
		},
		createDeferredForm: (coreOptions: CreateFormOptions<TData, TUi>) => {
			preflightPrepared(coreOptions, validators, scopedAsync);
			const runtime = createDeferredForm(withValidators(coreOptions));
			attach(runtime.form, coreOptions);
			return runtime;
		},
	};
}

function preflightPrepared<TData, TUi>(
	coreOptions: CreateFormOptions<TData, TUi>,
	validators: readonly SchemaValidator<TData, TUi>[],
	scopedAsync: ReturnType<typeof prepareScopedAsyncHost<TData, TUi>> | undefined,
): void {
	const all = [...validators, ...(coreOptions.validators ?? [])];
	if (new Set(all).size !== all.length) {
		throw new TypeError("Prepared validators must be installed only once; do not pass them as core validators.");
	}
	if (scopedAsync)
		assertScopedAsyncIds(
			scopedAsync,
			(coreOptions.asyncValidators ?? []).map((entry) => entry.id),
		);
}

function attachPrepared<TData, TUi>(
	form: ReturnType<typeof createForm<TData, TUi>>,
	coreOptions: CreateFormOptions<TData, TUi>,
	definition: ValidatedFormDefinition,
	scoped: ReturnType<typeof prepareScopedSyncHost<TData, TUi>> | undefined,
	scopedAsync: ReturnType<typeof prepareScopedAsyncHost<TData, TUi>> | undefined,
	omission: boolean,
): typeof form {
	bindOmissionSupplier(form as ReturnType<typeof createForm>, definition);
	if (scoped) registerScopedSync(form, scoped);
	if (scopedAsync)
		registerScopedAsync(
			form,
			scopedAsync,
			(coreOptions.asyncValidators ?? []).map((entry) => entry.id),
		);
	if (omission) activateBoundSubmit(form as ReturnType<typeof createForm>);
	return form;
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
