import { preflightJsonSchema } from "@formbar/from-schema";
import { disposeDemoSession, installDemo } from "../runtime/kalada-demo-install";
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
import { type PlaygroundRuntimeContext, standardPlaygroundContext } from "./runtime-context";

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
}

function preflight(values: Record<SourceKey, unknown>, errors: SourceErrors, context: PlaygroundRuntimeContext): void {
	if (Object.keys(errors).length > 0) return;
	const schema = values.schema as PlaygroundDocument["schema"];
	const schemaResult = preflightJsonSchema(schema);
	if (!schemaResult.ok) {
		errors.schema = schemaResult.error;
		return;
	}
	try {
		const host = installDemo(
			{ version: PLAYGROUND_DOCUMENT_VERSION, ...values } as PlaygroundDocument,
			undefined,
			context.profileIds,
			context.initialUiState,
			context.arbiterRules,
		);
		try {
			host.snapshot();
		} finally {
			disposeDemoSession(host);
		}
	} catch (error) {
		errors.definition = error instanceof Error ? error.message : "Kalada V1 installation failed";
	}
}

export type ParseDocumentResult =
	| { readonly ok: true; readonly document: PlaygroundDocument }
	| { readonly ok: false; readonly errors: SourceErrors };

export function parseDocument(
	sources: PlaygroundSources,
	context: PlaygroundRuntimeContext = standardPlaygroundContext,
): ParseDocumentResult {
	const errors: SourceErrors = {};
	const total = SOURCE_KEYS.reduce((size, key) => size + new Blob([sources[key]]).size, 0);
	if (total > TOTAL_LIMIT_BYTES) errors.schema = `All sources exceed ${TOTAL_LIMIT_BYTES.toLocaleString()} bytes`;
	const values = Object.fromEntries(SOURCE_KEYS.map((key) => [key, parseSource(key, sources[key], errors)])) as Record<
		SourceKey,
		unknown
	>;
	validateShapes(values, errors);
	preflight(values, errors, context);
	if (Object.keys(errors).length > 0) return { ok: false, errors };
	return { ok: true, document: { version: PLAYGROUND_DOCUMENT_VERSION, ...values } as PlaygroundDocument };
}
