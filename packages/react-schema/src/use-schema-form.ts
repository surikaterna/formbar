import type { FormApi, SchemaValidator } from "@formbar/core";
import type { FormDefinition, ValidatedFormDefinition } from "@formbar/declarative";
import type {
	CompileDefaultFormDefinitionOptions,
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
	};

export interface SchemaPreparationWarning {
	readonly channel: "source" | "projection" | "compilation";
	readonly code: string;
	readonly message: string;
}

export interface UseSchemaFormResult<TData, TUi> {
	readonly form: FormApi<TData, TUi>;
	readonly descriptors: DescriptorDocument;
	readonly definition: ValidatedFormDefinition;
	readonly diagnostics: SchemaFormDiagnostics;
	readonly warnings: readonly SchemaPreparationWarning[];
}

export function useSchemaForm<TData, TUi>(
	schema: unknown,
	options: UseSchemaFormOptions<TData, TUi>,
): UseSchemaFormResult<TData, TUi> {
	const prepared = usePreparedSchema(schema, options);
	const form = useForm<TData, TUi>({
		...formOptions(options),
		...(prepared.sourceValidator ? { schema: prepared.sourceValidator } : {}),
		...(options.validators ? { validators: options.validators } : {}),
	});
	return Object.freeze({
		form,
		descriptors: prepared.descriptors,
		definition: prepared.definition,
		diagnostics: prepared.diagnostics,
		warnings: warnings(prepared.diagnostics),
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
