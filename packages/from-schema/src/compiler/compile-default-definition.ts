import {
	type DefinitionDiagnostic,
	type FormDefinition,
	type ValidatedFormDefinition,
	validateFormDefinition,
} from "@formbar/declarative";
import type { DescriptorDocument } from "../descriptors/contracts.js";
import type { CompilationDiagnostic } from "../diagnostics.js";
import { sortCompilationDiagnostics } from "../diagnostics.js";
import { compileOccurrence } from "./compile-occurrence.js";
import { definitionId } from "./ids.js";

export interface CompileDefaultFormDefinitionOptions {
	readonly id?: string;
}

export interface CompileDefaultFormDefinitionResult {
	readonly definition?: ValidatedFormDefinition;
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
	return validation.ok
		? Object.freeze({
				definition: validation.value,
				diagnostics: sortCompilationDiagnostics(diagnostics),
				definitionDiagnostics: Object.freeze([]),
			})
		: Object.freeze({
				diagnostics: sortCompilationDiagnostics(diagnostics),
				definitionDiagnostics: validation.diagnostics,
			});
}
