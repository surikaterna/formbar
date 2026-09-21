import {
	type IngestDocumentResult,
	type LimitOptions,
	type SchemaDocumentProvider,
	type StandardSchemaV1,
	ingestSchemaDocument,
} from "@scheman/core";
import type { DescriptorDocument, DescriptorSide } from "./descriptors/contracts.js";
import type { ProjectionLimitOptions } from "./descriptors/limits.js";
import { projectSchemaDocument } from "./descriptors/project-document.js";

export interface ProjectSchemaOptions {
	readonly provider: SchemaDocumentProvider;
	readonly side: DescriptorSide;
	readonly limits?: LimitOptions;
	readonly projectionLimits?: ProjectionLimitOptions;
}

export interface ProjectSchemaResult<Input = unknown, Output = Input> {
	readonly descriptors: DescriptorDocument;
	readonly validator?: StandardSchemaV1<Input, Output>;
}

export function projectSchema<Input, Output>(
	schema: StandardSchemaV1<Input, Output>,
	options: ProjectSchemaOptions,
): ProjectSchemaResult<Input, Output>;
export function projectSchema(schema: unknown, options: ProjectSchemaOptions): ProjectSchemaResult;
export function projectSchema(schema: unknown, options: ProjectSchemaOptions): ProjectSchemaResult {
	const result: IngestDocumentResult = ingestSchemaDocument(schema, {
		provider: options.provider,
		...(options.limits ? { limits: options.limits } : {}),
	});
	const descriptors = projectSchemaDocument(result.document, {
		providerName: options.provider.name,
		side: options.side,
		...(options.projectionLimits ? { limits: options.projectionLimits } : {}),
	});
	return Object.freeze({ descriptors, ...(result.validator ? { validator: result.validator } : {}) });
}
