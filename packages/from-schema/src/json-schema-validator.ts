import type { ValidationIssue, ValidatorFn } from "@formbar/core";
import addFormats from "ajv-formats";
import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import type { ValidationDiagnostic } from "./diagnostics.js";

type Validator = ValidatorFn<unknown, unknown>;
const dialect = "https://json-schema.org/draft/2020-12/schema";
const maxBytes = 262144;
const maxNodes = 8192;
const maxDepth = 64;
const maxErrors = 100;
const formats = new Set(["date", "email", "uri"]);
const failureMessage = "JSON Schema validation could not be completed.";
const cache = new WeakMap<object, { fingerprint: string; preparation: JsonSchemaPreparation }>();
const Ajv = ("default" in Ajv2020 ? Ajv2020.default : Ajv2020) as unknown as typeof import("ajv/dist/2020.js").default;
type FormatInstaller = typeof import("ajv-formats").default;
const installFormats = ("default" in addFormats ? addFormats.default : addFormats) as unknown as FormatInstaller;

export interface JsonSchemaPreparation {
	readonly validator: Validator;
	readonly diagnostics: readonly ValidationDiagnostic[];
}

export function preflightJsonSchema(
	schema: unknown,
): { readonly ok: true } | { readonly ok: false; readonly error: string } {
	const result = prepareJsonSchema(schema, true);
	const diagnostic = result.diagnostics[0];
	return diagnostic ? { ok: false, error: diagnostic.message } : { ok: true };
}

export function createJsonSchemaValidator(schema: unknown): Validator {
	return prepareJsonSchema(schema, true).validator;
}

export function prepareJsonSchema(schema: unknown, supported: boolean): JsonSchemaPreparation {
	if (!supported)
		return failed("unsupported-dialect", "Only the local Draft 2020-12 JSON Schema provider is supported.");
	try {
		const snapshot = snapshotSchema(schema);
		const fingerprint = JSON.stringify(snapshot);
		const cached = schema !== null && typeof schema === "object" ? cache.get(schema) : undefined;
		if (cached?.fingerprint === fingerprint) return cached.preparation;
		checkKeywords(snapshot);
		const engine = new Ajv({
			addUsedSchema: false,
			allErrors: true,
			coerceTypes: false,
			messages: false,
			ownProperties: true,
			removeAdditional: false,
			useDefaults: false,
			strict: false,
			strictSchema: true,
			validateFormats: true,
		});
		installFormats(engine, { formats: ["date", "email", "uri"] });
		engine.addKeyword({ keyword: "x-formbar", valid: true });
		engine.addKeyword({ keyword: "$anchor", schemaType: "string", valid: true });
		const validate = engine.compile(snapshot as Record<string, unknown> | boolean);
		if (Object.getOwnPropertyDescriptor(validate, "$async")?.value === true)
			return failed("unsupported-async", "Asynchronous JSON Schema is not supported.");
		const validator: Validator = ({ data }) => execute(validate, data);
		const preparation = Object.freeze({ validator, diagnostics: Object.freeze([]) });
		if (schema !== null && typeof schema === "object") cache.set(schema, { fingerprint, preparation });
		return preparation;
	} catch (error) {
		const reason = error instanceof SchemaRejection ? error.reason : "invalid-schema";
		const preparation = failed(reason, `Schema is not valid Draft 2020-12 (${reason}).`);
		return preparation;
	}
}

class SchemaRejection extends Error {
	constructor(readonly reason: string) {
		super(reason);
	}
}

function reject(reason: string): never {
	throw new SchemaRejection(reason);
}

function snapshotSchema(schema: unknown): unknown {
	const seen = new WeakSet<object>();
	let nodes = 0;
	let bytes = 0;
	function copy(value: unknown, depth: number): unknown {
		if (++nodes > maxNodes || depth > maxDepth) reject("schema-limit");
		if (value === null || typeof value === "boolean") return value;
		if (typeof value === "number" && Number.isFinite(value)) return value;
		if (typeof value === "string") {
			bytes += new TextEncoder().encode(value).length;
			if (bytes > maxBytes) reject("schema-limit");
			return value;
		}
		if (typeof value !== "object" || seen.has(value)) reject("non-json-schema");
		seen.add(value);
		const result: unknown = Array.isArray(value) ? [] : Object.create(null);
		const descriptors = Object.getOwnPropertyDescriptors(value);
		if (Array.isArray(value) && (value.length > maxNodes || Object.keys(descriptors).length !== value.length + 1))
			reject("non-json-schema");
		for (const key of Reflect.ownKeys(descriptors)) {
			if (typeof key !== "string") reject("non-json-schema");
			if (Array.isArray(value) && key === "length") continue;
			if (Array.isArray(value) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))
				reject("non-json-schema");
			const property = descriptors[key];
			if (!property?.enumerable || !("value" in property)) reject("non-json-schema");
			bytes += new TextEncoder().encode(key).length;
			if (bytes > maxBytes) reject("schema-limit");
			Object.defineProperty(result, key, {
				value: copy(property.value, depth + 1),
				enumerable: true,
				configurable: true,
				writable: true,
			});
		}
		seen.delete(value);
		return result;
	}
	return copy(schema, 0);
}

function checkKeywords(schema: unknown): void {
	function walk(value: unknown, key = "") {
		if (!value || typeof value !== "object") return;
		if (Array.isArray(value)) {
			for (const item of value) walk(item, key);
			return;
		}
		const record = value as Record<string, unknown>;
		if (key === "enum" || key === "const" || key === "default" || key === "examples" || key === "x-formbar") return;
		if (record.$schema !== undefined && record.$schema !== dialect && record.$schema !== `${dialect}#`)
			reject("unsupported-dialect");
		if (record.$vocabulary !== undefined) reject("unsupported-vocabulary");
		if (record.$async !== undefined) reject("unsupported-async");
		if (typeof record.$ref === "string" && !record.$ref.startsWith("#")) reject("unsupported-ref");
		if (typeof record.$dynamicRef === "string" && !record.$dynamicRef.startsWith("#")) reject("unsupported-ref");
		if (typeof record.format === "string" && !formats.has(record.format)) reject("unsupported-format");
		for (const [name, child] of Object.entries(record)) {
			if (name === "x-formbar") continue;
			walk(child, name);
		}
	}
	walk(schema);
}

function failed(code: string, message: string): JsonSchemaPreparation {
	const diagnostics = Object.freeze([Object.freeze({ code, message, severity: "error" as const })]);
	const issueCode = code === "unsupported-async" ? "json-schema.unsupported-async" : "json-schema.adapter-failure";
	const issueText =
		code === "unsupported-async" ? "Asynchronous JSON Schema validation is not supported." : failureMessage;
	return Object.freeze({ diagnostics, validator: () => Object.freeze([issue(issueCode, issueText, [])]) });
}

function execute(validate: ValidateFunction, data: unknown): readonly ValidationIssue[] {
	try {
		const valid: unknown = validate(data);
		if (valid === true) return [];
		if (valid !== false) return [issue("json-schema.adapter-failure", failureMessage, [])];
		const errors = validate.errors ?? [];
		const issues = errors.slice(0, maxErrors).map((error) => adapt(error, data));
		if (errors.length > maxErrors)
			issues.push(issue("json-schema.truncated", "Additional validation errors were omitted.", []));
		const unique = new Map(issues.map((item) => [JSON.stringify([item.path.segments, item.code, item.message]), item]));
		return Object.freeze(
			[...unique.values()].sort((a, b) => {
				const left = JSON.stringify(a.path.segments);
				const right = JSON.stringify(b.path.segments);
				return left < right ? -1 : left > right ? 1 : a.code.localeCompare(b.code);
			}),
		);
	} catch {
		return [issue("json-schema.adapter-failure", failureMessage, [])];
	}
}

function adapt(error: ErrorObject, data: unknown): ValidationIssue {
	let container = data;
	const segments: (string | number)[] = [];
	for (const token of error.instancePath.slice(1).split("/")) {
		if (!error.instancePath) break;
		const decoded = token.replaceAll("~1", "/").replaceAll("~0", "~");
		const segment = Array.isArray(container) && /^(0|[1-9]\d*)$/.test(decoded) ? Number(decoded) : decoded;
		segments.push(segment);
		container = Object.getOwnPropertyDescriptor(Object(container), String(segment))?.value;
	}
	if (error.keyword === "required" && typeof error.params.missingProperty === "string")
		segments.push(error.params.missingProperty);
	if (error.keyword === "additionalProperties" && typeof error.params.additionalProperty === "string")
		segments.push(error.params.additionalProperty);
	const params = error.params as Record<string, unknown>;
	let message: string;
	switch (error.keyword) {
		case "required":
			message = `Required property ${JSON.stringify(String(params.missingProperty))} is missing.`;
			break;
		case "format":
			message = `Must match the ${JSON.stringify(String(params.format))} format.`;
			break;
		case "enum":
			message = "Must be one of the allowed values.";
			break;
		case "const":
			message = "Must equal the declared constant.";
			break;
		case "minLength":
			message = `Must contain at least ${String(params.limit)} character(s).`;
			break;
		case "maxLength":
			message = `Must contain at most ${String(params.limit)} character(s).`;
			break;
		default:
			message = `Does not satisfy JSON Schema keyword ${JSON.stringify(error.keyword)}.`;
	}
	return issue(`json-schema.${error.keyword}`, message, segments);
}

function issue(code: string, message: string, segments: readonly (string | number)[]): ValidationIssue {
	return Object.freeze({
		code,
		message,
		severity: "error",
		path: Object.freeze({ namespace: "data", segments: Object.freeze(segments) }),
		source: Object.freeze({
			origin: "json-schema-adapter",
			validatorId: "json-schema-draft-2020-12",
			adapterId: "json-schema-adapter",
		}),
	});
}
