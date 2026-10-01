import type { JsonValue } from "@formbar/declarative";
import type { DescriptorDocument } from "../descriptors/contracts.js";
import { compileOccurrence } from "./compile-occurrence.js";
import { definitionId } from "./ids.js";

export interface CompileDefaultFormDefinitionOptions {
	readonly id?: string;
}

export interface GeneratedKaladaDefinition {
	readonly version: 1;
	readonly id: string;
	readonly root: JsonValue;
}

export interface CompileDefaultFormDefinitionResult {
	readonly definition: GeneratedKaladaDefinition;
}

/** A candidate only: the caller must supply policy, strategy and direct write proofs at installation. */
export function compileDefaultKaladaV1Definition(
	document: DescriptorDocument,
	options?: CompileDefaultFormDefinitionOptions,
): GeneratedKaladaDefinition {
	if (
		document.source.availability !== "complete" ||
		document.source.side !== "input" ||
		document.sourceDiagnostics.length ||
		document.projectionDiagnostics.length
	)
		throw new TypeError("Kalada V1 generation requires a complete input-side schema projection.");
	return {
		version: 1,
		id: options?.id ?? definitionId(document.source.provider, document.source.side),
		root: compileOccurrence(document, document.rootOccurrenceId, { segments: [] }, "root"),
	};
}

/** Compatibility spelling; never compiles a legacy Kuery definition or runtime baseline. */
export function compileDefaultFormDefinition(
	document: DescriptorDocument,
	options?: CompileDefaultFormDefinitionOptions,
): CompileDefaultFormDefinitionResult {
	return { definition: compileDefaultKaladaV1Definition(document, options) };
}
