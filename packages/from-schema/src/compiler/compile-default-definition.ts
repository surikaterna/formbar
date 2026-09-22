import {
	type DefinitionDiagnostic,
	type FormDefinition,
	type RuntimeFieldBaseline,
	type ValidatedFormDefinition,
	validateFormDefinition,
} from "@formbar/declarative";
import type { DescriptorDocument } from "../descriptors/contracts.js";
import type { CompilationDiagnostic } from "../diagnostics.js";
import { sortCompilationDiagnostics } from "../diagnostics.js";
import { adaptRuntimeFieldBaseline } from "../runtime-baseline.js";
import { compileOccurrence } from "./compile-occurrence.js";
import { definitionId } from "./ids.js";

export interface CompileDefaultFormDefinitionOptions {
	readonly id?: string;
}

export interface CompileDefaultFormDefinitionResult {
	readonly definition?: ValidatedFormDefinition;
	readonly baseline: readonly RuntimeFieldBaseline[];
	readonly diagnostics: readonly CompilationDiagnostic[];
	readonly definitionDiagnostics: readonly DefinitionDiagnostic[];
}

export function compileDefaultFormDefinition(
	document: DescriptorDocument,
	options?: CompileDefaultFormDefinitionOptions,
): CompileDefaultFormDefinitionResult {
	const diagnostics: CompilationDiagnostic[] = [];
	const root = compileOccurrence({ document, diagnostics }, document.rootOccurrenceId, { segments: [] });
	const candidate: FormDefinition = {
		version: 1,
		id: options?.id ?? definitionId(document.source.provider, document.source.side),
		root,
	};
	const validation = validateFormDefinition(candidate);
	if (!validation.ok)
		return Object.freeze({
			baseline: Object.freeze([]),
			diagnostics: sortCompilationDiagnostics(diagnostics),
			definitionDiagnostics: validation.diagnostics,
		});
	const adapted = adaptRuntimeFieldBaseline(document, validation.value);
	return Object.freeze({
		definition: validation.value,
		baseline: adapted.baseline,
		diagnostics: sortCompilationDiagnostics([...diagnostics, ...adapted.diagnostics]),
		definitionDiagnostics: Object.freeze([]),
	});
}
