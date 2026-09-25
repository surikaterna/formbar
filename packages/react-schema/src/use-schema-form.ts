import type { FormApi, SchemaValidator } from "@formbar/core";
import type {
	FormDefinition,
	RuntimeFieldBaseline,
	RuntimeRepeaterBaseline,
	ValidatedFormDefinition,
} from "@formbar/declarative";
import type {
	CompileDefaultFormDefinitionOptions,
	DefinitionAsyncFieldValidator,
	DefinitionFieldValidator,
	DescriptorDocument,
	DescriptorSide,
	LimitOptions,
	ProjectionLimitOptions,
	SchemaDocumentProvider,
	SchemaFormDiagnostics,
} from "@formbar/from-schema";
import { createSchemaForm } from "@formbar/from-schema";
import { type UseFormOptions, useForm } from "@formbar/react";
import { useMemo } from "react";
import { mergeInitialData, schemaInitialData } from "./schema-initial-data.js";

interface SchemaPreparationOptions {
	readonly provider: SchemaDocumentProvider;
	readonly side: DescriptorSide;
	readonly limits?: LimitOptions;
	readonly projectionLimits?: ProjectionLimitOptions;
	readonly definition?: FormDefinition;
	readonly generation?: CompileDefaultFormDefinitionOptions;
}

export type UseSchemaFormOptions<TData, TUi> = Omit<UseFormOptions<TData, TUi>, "schema" | "validators"> &
	SchemaPreparationOptions & {
		readonly validators?: readonly SchemaValidator<TData, TUi>[];
		readonly fieldValidators?: readonly DefinitionFieldValidator<TData, TUi>[];
		readonly asyncFieldValidators?: readonly DefinitionAsyncFieldValidator<TData, TUi>[];
	};

export interface SchemaPreparationWarning {
	readonly channel: "source" | "projection" | "compilation" | "initialization";
	readonly code: string;
	readonly message: string;
}

export interface UseSchemaFormResult<TData, TUi> {
	readonly form: FormApi<TData, TUi>;
	readonly descriptors: DescriptorDocument;
	readonly definition: ValidatedFormDefinition;
	readonly baseline: readonly RuntimeFieldBaseline[];
	readonly repeaterBaseline: readonly RuntimeRepeaterBaseline[];
	readonly diagnostics: SchemaFormDiagnostics;
	readonly warnings: readonly SchemaPreparationWarning[];
}

export function useSchemaForm<TData, TUi>(
	schema: unknown,
	options: UseSchemaFormOptions<TData, TUi>,
): UseSchemaFormResult<TData, TUi> {
	const prepared = usePreparedSchema(schema, options);
	const initial = schemaInitialData(prepared.descriptors, schema);
	const sourceValidator = prepared.sourceValidator as SchemaValidator<TData, TUi> | undefined;
	const validators = [...(sourceValidator ? [sourceValidator] : []), ...prepared.validators];
	const baseOptions = formOptions(options);
	const initialData = mergeInitialData(initial.defaults, baseOptions.initialData);
	const form = useForm<TData, TUi>(
		{
			...baseOptions,
			...(Object.keys(initial.defaults).length > 0 ? { initialData: initialData as TData } : {}),
			...(validators.length > 0 ? { validators } : {}),
		},
		prepared.createDeferredForm,
	);
	return Object.freeze({
		form,
		descriptors: prepared.descriptors,
		definition: prepared.definition,
		baseline: prepared.baseline,
		repeaterBaseline: prepared.repeaterBaseline,
		diagnostics: prepared.diagnostics,
		warnings: [...warnings(prepared.diagnostics), ...initial.warnings],
	});
}

function usePreparedSchema<TData, TUi>(schema: unknown, options: UseSchemaFormOptions<TData, TUi>) {
	return useMemo(
		() =>
			createSchemaForm<TData, TUi>(schema, {
				provider: options.provider,
				side: options.side,
				...(options.limits ? { limits: options.limits } : {}),
				...(options.projectionLimits ? { projectionLimits: options.projectionLimits } : {}),
				...(options.definition ? { definition: options.definition } : {}),
				...(options.generation ? { generation: options.generation } : {}),
				...(options.validators ? { validators: options.validators } : {}),
				...(options.fieldValidators ? { fieldValidators: options.fieldValidators } : {}),
				...(options.asyncFieldValidators ? { asyncFieldValidators: options.asyncFieldValidators } : {}),
			}),
		[
			schema,
			options.provider,
			options.side,
			options.limits,
			options.projectionLimits,
			options.definition,
			options.generation,
			options.validators,
			options.fieldValidators,
			options.asyncFieldValidators,
		],
	);
}

function formOptions<TData, TUi>(options: UseSchemaFormOptions<TData, TUi>): UseFormOptions<TData, TUi> {
	const {
		provider: _provider,
		side: _side,
		limits: _limits,
		projectionLimits: _projectionLimits,
		definition: _definition,
		generation: _generation,
		validators: _validators,
		fieldValidators: _fieldValidators,
		asyncFieldValidators: _asyncFieldValidators,
		...form
	} = options;
	return form;
}

function warnings(diagnostics: SchemaFormDiagnostics): readonly SchemaPreparationWarning[] {
	return Object.freeze([
		...diagnostics.source
			.filter((item) => item.severity === "warning")
			.map((item) => ({
				channel: "source" as const,
				code: item.code,
				message: `${item.side}:${item.sourcePointer}`,
			})),
		...diagnostics.projection
			.filter((item) => item.severity === "warning")
			.map((item) => ({
				channel: "projection" as const,
				code: item.code,
				message: item.message,
			})),
		...diagnostics.compilation
			.filter((item) => item.severity === "warning")
			.map((item) => ({
				channel: "compilation" as const,
				code: item.code,
				message: item.message,
			})),
	]);
}
