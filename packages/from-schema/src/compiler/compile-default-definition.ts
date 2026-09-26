import {
	type DefinitionDiagnostic,
	type FormDefinition,
	type FormNode,
	type RuntimeFieldBaseline,
	type RuntimeRepeaterBaseline,
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
	/** Generated field IDs, not data paths or row indexes. */
	readonly submitWhenHidden?: Readonly<Record<string, "include">>;
}

export interface CompileDefaultFormDefinitionResult {
	readonly definition?: ValidatedFormDefinition;
	readonly baseline: readonly RuntimeFieldBaseline[];
	readonly repeaterBaseline: readonly RuntimeRepeaterBaseline[];
	readonly diagnostics: readonly CompilationDiagnostic[];
	readonly definitionDiagnostics: readonly DefinitionDiagnostic[];
}

export function compileDefaultFormDefinition(
	document: DescriptorDocument,
	options?: CompileDefaultFormDefinitionOptions,
	submission?: FormDefinition["submission"],
): CompileDefaultFormDefinitionResult {
	const diagnostics: CompilationDiagnostic[] = [];
	const root = compileOccurrence({ document, diagnostics }, document.rootOccurrenceId, { segments: [] });
	const overrides = options?.submitWhenHidden;
	const fields = new Set<string>();
	const generated = applyHiddenOverrides(root, overrides, fields);
	if (overrides && Object.keys(overrides).some((id) => !fields.has(id) || overrides[id] !== "include")) {
		throw new TypeError("Generated hidden inclusion requires an existing field ID and 'include' value.");
	}
	const candidate: FormDefinition = {
		version: 1,
		id: options?.id ?? definitionId(document.source.provider, document.source.side),
		root: generated,
		...(submission ? { submission } : {}),
	};
	const validation = validateFormDefinition(candidate);
	if (!validation.ok)
		return Object.freeze({
			baseline: Object.freeze([]),
			repeaterBaseline: Object.freeze([]),
			diagnostics: sortCompilationDiagnostics(diagnostics),
			definitionDiagnostics: validation.diagnostics,
		});
	const adapted = adaptRuntimeFieldBaseline(document, validation.value);
	return Object.freeze({
		definition: validation.value,
		baseline: adapted.baseline,
		repeaterBaseline: adapted.repeaterBaseline,
		diagnostics: sortCompilationDiagnostics([...diagnostics, ...adapted.diagnostics]),
		definitionDiagnostics: Object.freeze([]),
	});
}

function applyHiddenOverrides(
	node: FormNode,
	overrides: CompileDefaultFormDefinitionOptions["submitWhenHidden"],
	fields: Set<string>,
): FormNode {
	if (node.type === "field") {
		fields.add(node.id);
		return overrides && Object.hasOwn(overrides, node.id) ? { ...node, submitWhenHidden: overrides[node.id] } : node;
	}
	if (node.type === "group" || node.type === "section" || node.type === "repeater") {
		return { ...node, children: node.children.map((child) => applyHiddenOverrides(child, overrides, fields)) };
	}
	return node;
}
