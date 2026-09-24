import { validateFormDefinition } from "@formbar/declarative";
import { createSchemaForm, jsonSchemaProvider } from "@formbar/from-schema";
import { preflightJsonSchema } from "../validation/json-schema-validator";
import {
	PLAYGROUND_DOCUMENT_VERSION,
	type PlaygroundDocument,
	type PlaygroundSources,
	SOURCE_KEYS,
	SOURCE_LIMIT_BYTES,
	type SourceErrors,
	type SourceKey,
	TOTAL_LIMIT_BYTES,
} from "./contracts";

export function stringifyDocument(document: PlaygroundDocument): PlaygroundSources {
	return {
		schema: formatJson(document.schema),
		definition: formatJson(document.definition),
		initialData: formatJson(document.initialData),
	};
}

export function formatJson(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSource(key: SourceKey, source: string, errors: SourceErrors): unknown {
	if (new Blob([source]).size > SOURCE_LIMIT_BYTES) {
		errors[key] = `Source exceeds ${SOURCE_LIMIT_BYTES.toLocaleString()} bytes`;
		return;
	}
	try {
		return JSON.parse(source);
	} catch (error) {
		errors[key] = error instanceof Error ? error.message : "Invalid JSON";
	}
}

function validateShapes(values: Record<SourceKey, unknown>, errors: SourceErrors): void {
	if (!errors.schema && !isRecord(values.schema)) errors.schema = "Schema must be a JSON object";
	if (!errors.definition && values.definition !== null && !isRecord(values.definition))
		errors.definition = "Definition must be a JSON object or null (generate from schema)";
	if (!errors.initialData && !isRecord(values.initialData)) errors.initialData = "Initial Data must be a JSON object";
	if (!errors.definition && values.definition !== null) {
		const result = validateFormDefinition(values.definition);
		if (!result.ok) errors.definition = `Definition is invalid: ${result.diagnostics[0]?.message ?? "unknown error"}`;
	}
}

function preflight(values: Record<SourceKey, unknown>, errors: SourceErrors): void {
	if (Object.keys(errors).length > 0) return;
	const schema = values.schema as PlaygroundDocument["schema"];
	const schemaResult = preflightJsonSchema(schema);
	if (!schemaResult.ok) {
		errors.schema = schemaResult.error;
		return;
	}
	try {
		createSchemaForm(schema, {
			provider: jsonSchemaProvider({ dialect: "draft-2020-12" }),
			side: "input",
			...(values.definition === null
				? {}
				: { definition: values.definition as NonNullable<PlaygroundDocument["definition"]> }),
		});
	} catch (error) {
		errors.schema = `Schema compilation failed: ${error instanceof Error ? error.message : String(error)}`;
	}
}

export type ParseDocumentResult =
	| { readonly ok: true; readonly document: PlaygroundDocument }
	| { readonly ok: false; readonly errors: SourceErrors };

export function parseDocument(sources: PlaygroundSources): ParseDocumentResult {
	const errors: SourceErrors = {};
	const total = SOURCE_KEYS.reduce((size, key) => size + new Blob([sources[key]]).size, 0);
	if (total > TOTAL_LIMIT_BYTES) errors.schema = `All sources exceed ${TOTAL_LIMIT_BYTES.toLocaleString()} bytes`;
	const values = Object.fromEntries(SOURCE_KEYS.map((key) => [key, parseSource(key, sources[key], errors)])) as Record<
		SourceKey,
		unknown
	>;
	validateShapes(values, errors);
	preflight(values, errors);
	if (Object.keys(errors).length > 0) return { ok: false, errors };
	return { ok: true, document: { version: PLAYGROUND_DOCUMENT_VERSION, ...values } as PlaygroundDocument };
}
