// Re-export schema-core types and functions that consumers previously imported from formbar-from-schema
export {
	clearExtractorRegistry,
	createValidationOnlyResult,
	extractFromJsonSchema,
	extractFromZod,
	extractFromZodV4,
	findExtractor,
	ingestSchema,
	isStandardSchema,
	isZodSchema,
	isZodV4Schema,
	type JsonSchema,
	type MergeInput,
	type MetadataSource,
	mergeMetadata,
	mergeSamePrecedence,
	registerExtractor,
	SchemaError,
	type SchemaErrorCode,
	type SchemaExtractor,
	type SchemaFieldInfo,
	type SchemaFieldMetadata,
	type SchemaFieldType,
	type SchemaIngestionResult,
	type SchemaMetadata,
	type StandardSchemaV1,
	structuralEqual,
} from "@scheman/core";
export { createJsonSchemaValidator, isJsonSchema } from "./adapters/json-schema-validator.js";
// Local exports that remain in formbar-from-schema
export {
	resolveAllConditionalRequired,
	resolveDependentRequired,
	resolveExpressionRequired,
	resolveIfThenElseRequired,
	resolveOneOfRequired,
} from "./conditional-required.js";
export {
	type CreateSchemaFormOptions,
	createSchemaForm,
	type SchemaFormResult,
} from "./create-schema-form.js";
export {
	type FormbarOption,
	type FormbarOptionRecord,
	type FormbarOptionsMetadata,
	type FormbarOptionsResult,
	type FormbarOptionTitleContext,
	type FormbarOptionTitleResolver,
	type FormbarOptionValue,
	type FormbarOptionWarning,
	type FormbarOptionWarningCode,
	type NormalizeFormbarOptionsOptions,
	normalizeFormbarOptions,
} from "./formbar-options.js";
export { FromSchemaError, type FromSchemaErrorCode } from "./errors.js";
export { applyFormbarMetadata } from "./formbar-metadata.js";
export { compileLayout, type LayoutCompileOptions } from "./layout/layout-compiler.js";
export { type LayoutNodeDefinition, LayoutNodeRegistry } from "./layout/layout-registry.js";
export {
	type ArrayNode,
	type ArrayNodeProps,
	type BuiltInLayoutNodeType,
	type FieldNode,
	type FieldNodeProps,
	type GroupNode,
	type GroupNodeProps,
	isArrayNode,
	isBuiltInNodeType,
	isFieldNode,
	isGroupNode,
	isSectionNode,
	type LayoutNode,
	type LayoutNodeType,
	type SectionNode,
	type SectionNodeProps,
} from "./layout/layout-types.js";
export {
	applyLayoutMiddleware,
	type LayoutMiddleware,
	type LayoutMiddlewareContext,
} from "./layout-middleware.js";
export {
	createFormPresentation,
	DEFAULT_FIELD_STATE,
	descriptionId,
	errorId,
	type FieldStateDefinition,
	fieldId,
	type FormPresentation,
	type FormPresentationSource,
	type FormPresentationStateInput,
	type PresentationField,
	type PresentationFieldIds,
	pruneHiddenFields,
	type ResolvedFieldState,
	resolveFieldStates,
} from "./presentation-model.js";
export { hasUiPaths, isValidUiSchema, validateUiSchemaRequirement } from "./ui-schema-check.js";
