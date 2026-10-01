import {
	type CreateKaladaV1HostOptions,
	type JsonValue,
	type SchemaValidatorV1,
	createKaladaV1Host,
} from "@formbar/declarative";
import type { LimitOptions, SchemaDocumentProvider } from "@scheman/core";
import { compileDefaultKaladaV1Definition } from "./compiler/compile-default-definition.js";
import { compileKaladaDefaults } from "./compiler/compile-kalada-defaults.js";
import { authoredNativeEvidence } from "./compiler/kalada-authored-native-evidence.js";
import type { DescriptorSide } from "./descriptors/contracts.js";
import type { ProjectionLimitOptions } from "./descriptors/limits.js";
import { createJsonSchemaValidator } from "./json-schema-validator.js";
import { captureInitialData } from "./kalada-initial-data.js";
import { isJsonProvider, isSupportedJsonProvider } from "./providers/json-schema-provider.js";
import { projectSchema } from "./schema-source.js";

export interface CreateKaladaSchemaFormOptions
	extends Omit<CreateKaladaV1HostOptions, "definition" | "initialization"> {
	readonly provider: SchemaDocumentProvider;
	readonly side: DescriptorSide;
	readonly initialData?: JsonValue;
	readonly limits?: LimitOptions;
	readonly projectionLimits?: ProjectionLimitOptions;
	readonly generation?: { readonly id?: string };
	/** Authored canonical V1 definition replaces the generated layout; schema still owns defaults and validation. */
	readonly definition?: unknown;
}

function schemaValidation(
	schema: unknown,
	options: CreateKaladaSchemaFormOptions,
	projected: ReturnType<typeof projectSchema>,
): SchemaValidatorV1[] {
	if (projected.validator) {
		const validator = projected.validator;
		return [
			async (data) => {
				const result = await validator["~standard"].validate(data);
				return (result.issues ?? []).map((issue) => ({
					path: (issue.path ?? []).map((part) => {
						const key = typeof part === "object" && part !== null && "key" in part ? part.key : part;
						if (typeof key !== "number" && typeof key !== "string") throw new TypeError("Unknown schema issue path.");
						return key;
					}),
					message: issue.message,
					source: "schema" as const,
				}));
			},
		];
	}
	if (!isJsonProvider(options.provider)) throw new TypeError("Schema validation requires a supported provider.");
	if (!isSupportedJsonProvider(options.provider)) throw new TypeError("Unsupported JSON Schema dialect.");
	const validate = createJsonSchemaValidator(schema);
	return [
		(data) =>
			validate({ data, uiState: {} }).map((issue) => ({
				path: issue.path.segments.filter(
					(part): part is string | number => typeof part === "string" || typeof part === "number",
				),
				message: issue.message,
				source: "schema" as const,
			})),
	];
}

/** Fail closed: legacy FormApi/Kuery cannot be installed through the V1 schema entry point. */
export function createSchemaForm(_schema: unknown, _options: unknown): never {
	throw new TypeError(
		"createSchemaForm is no longer supported; migrate to createKaladaSchemaForm with host policy, identity, strategy and direct write locations.",
	);
}

/** Candidate V1 generation and installation; never creates a FormApi or legacy expression reader. */
export function createKaladaSchemaForm(schema: unknown, options: CreateKaladaSchemaFormOptions) {
	const initialData = captureInitialData(options);
	if (options.side !== "input") throw new TypeError("Kalada V1 requires an input-side schema.");
	if (options.definition !== undefined && options.generation !== undefined)
		throw new TypeError("Authored definition conflicts with generated layout options.");
	const descriptors = projectSchema(schema, {
		provider: options.provider,
		side: options.side,
		...(options.limits ? { limits: options.limits } : {}),
		...(options.projectionLimits ? { projectionLimits: options.projectionLimits } : {}),
	});
	const definition =
		options.definition === undefined
			? compileDefaultKaladaV1Definition(descriptors.descriptors, options.generation)
			: authoredNativeEvidence(options.definition, descriptors.descriptors);
	const defaults = compileKaladaDefaults(descriptors.descriptors);
	const extensions: SchemaValidatorV1[] = (options.validators ?? []).map(
		(validator) => async (data, signal) =>
			(await validator(data, signal)).map((issue) => ({ ...issue, source: "extension" })),
	);
	const validators = [...schemaValidation(schema, options, descriptors), ...extensions];
	const host = createKaladaV1Host({
		definition,
		policy: options.policy,
		identity: options.identity,
		strategy: options.strategy,
		validators,
		...(defaults.length || initialData !== undefined
			? {
					initialization: {
						defaults,
						...(initialData === undefined ? {} : { overrides: initialData }),
					},
				}
			: {}),
		...(options.writeSources ? { writeSources: options.writeSources } : {}),
		...(options.directLocations ? { directLocations: options.directLocations } : {}),
		...(options.installed ? { installed: options.installed } : {}),
		...(options.scopedValidators ? { scopedValidators: options.scopedValidators } : {}),
	});
	return Object.freeze({ descriptors: descriptors.descriptors, definition, host });
}
