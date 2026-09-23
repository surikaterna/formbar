import type { ValidationIssue, ValidatorFn } from "@formbar/core";
import addFormats from "ajv-formats";
import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";

type DemoValidator = ValidatorFn<Record<string, unknown>, Record<string, unknown>>;

interface CacheEntry {
	readonly validator: DemoValidator;
	readonly list: readonly DemoValidator[];
}

const adapterId = "json-schema-adapter";
const validatorId = "json-schema-draft-2020-12";
const emptyIssues: readonly ValidationIssue[] = Object.freeze([]);
const compileFailureIssues = fixedIssues(
	"json-schema.adapter-failure",
	"JSON Schema validation could not be completed.",
);
const unsupportedAsyncIssues = fixedIssues(
	"json-schema.unsupported-async",
	"Asynchronous JSON Schema validation is not supported.",
);
const cache = new WeakMap<object, CacheEntry>();

export function createJsonSchemaValidator(schema: Readonly<Record<string, unknown>>): DemoValidator {
	return cachedEntry(schema).validator;
}

export function createJsonSchemaValidators(schema: Readonly<Record<string, unknown>>): readonly DemoValidator[] {
	return cachedEntry(schema).list;
}

function cachedEntry(schema: Readonly<Record<string, unknown>>): CacheEntry {
	const cached = cache.get(schema);
	if (cached) return cached;
	const entry = compileEntry(schema);
	cache.set(schema, entry);
	return entry;
}

function compileEntry(schema: Readonly<Record<string, unknown>>): CacheEntry {
	try {
		if (declaresAsync(schema)) return fixedEntry(unsupportedAsyncIssues);
		const validate = createEngine().compile<Record<string, unknown>>(schema);
		if (compiledAsAsync(validate)) return fixedEntry(unsupportedAsyncIssues);
		return validatorEntry(({ data }) => execute(validate, data));
	} catch {
		return fixedEntry(compileFailureIssues);
	}
}

function createEngine(): Ajv2020 {
	const engine = new Ajv2020({
		addUsedSchema: false,
		allErrors: true,
		coerceTypes: false,
		messages: false,
		ownProperties: true,
		removeAdditional: false,
		strict: false,
		useDefaults: false,
		validateFormats: true,
	});
	addFormats(engine, { formats: ["date", "email", "uri"] });
	engine.addFormat("tel", true);
	return engine;
}

function declaresAsync(schema: Readonly<Record<string, unknown>>): boolean {
	const descriptor = Object.getOwnPropertyDescriptor(schema, "$async");
	if (!descriptor) return false;
	if (!("value" in descriptor)) throw new TypeError("Schema keywords must be data properties");
	return descriptor.value === true;
}

function compiledAsAsync(validate: ValidateFunction<Record<string, unknown>>): boolean {
	return Object.getOwnPropertyDescriptor(validate, "$async")?.value === true;
}

function execute(
	validate: ValidateFunction<Record<string, unknown>>,
	data: Record<string, unknown>,
): readonly ValidationIssue[] {
	try {
		const result: unknown = validate(data);
		if (isPromiseLike(result)) {
			void Promise.resolve(result).catch(() => undefined);
			return unsupportedAsyncIssues;
		}
		if (result === true) return emptyIssues;
		return adaptJsonSchemaErrors(validate.errors ?? [], data);
	} catch {
		return compileFailureIssues;
	}
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	if ((typeof value !== "object" || value === null) && typeof value !== "function") return false;
	return typeof Reflect.get(value, "then") === "function";
}

export function adaptJsonSchemaErrors(
	errors: readonly ErrorObject[],
	data: Record<string, unknown>,
): readonly ValidationIssue[] {
	const issues = errors.map((error) => toValidationIssue(error, data));
	const unique = new Map(issues.map((issue) => [issueKey(issue), issue]));
	return Object.freeze([...unique.values()].sort(compareIssues));
}

function toValidationIssue(error: ErrorObject, data: Record<string, unknown>): ValidationIssue {
	return Object.freeze({
		code: `json-schema.${error.keyword}`,
		message: issueMessage(error),
		severity: "error" as const,
		path: Object.freeze({ namespace: "data" as const, segments: Object.freeze(errorSegments(error, data)) }),
		source: issueSource(),
	});
}

function errorSegments(error: ErrorObject, data: Record<string, unknown>): (string | number)[] {
	const segments = pointerSegments(error.instancePath, data);
	if (error.keyword === "required" && typeof error.params.missingProperty === "string") {
		segments.push(error.params.missingProperty);
	}
	if (error.keyword === "additionalProperties" && typeof error.params.additionalProperty === "string") {
		segments.push(error.params.additionalProperty);
	}
	return segments;
}

function pointerSegments(pointer: string, data: unknown): (string | number)[] {
	if (!pointer) return [];
	let container = data;
	return pointer
		.slice(1)
		.split("/")
		.map((token) => {
			const decoded = token.replaceAll("~1", "/").replaceAll("~0", "~");
			const segment = Array.isArray(container) && /^(0|[1-9]\d*)$/.test(decoded) ? Number(decoded) : decoded;
			container = ownDataValue(container, segment);
			return segment;
		});
}

function ownDataValue(container: unknown, segment: string | number): unknown {
	if (container === null || typeof container !== "object") return undefined;
	const descriptor = Object.getOwnPropertyDescriptor(container, String(segment));
	if (!descriptor) return undefined;
	if (!("value" in descriptor)) throw new TypeError("Validation data must use data properties");
	return descriptor.value;
}

function issueMessage(error: ErrorObject): string {
	const params = error.params as Record<string, unknown>;
	switch (error.keyword) {
		case "required":
			return `Required property ${quoted(params.missingProperty)} is missing.`;
		case "type":
			return `Must be ${String(params.type)}.`;
		case "minLength":
			return `Must contain at least ${String(params.limit)} character(s).`;
		case "maxLength":
			return `Must contain at most ${String(params.limit)} character(s).`;
		case "format":
			return `Must match the ${quoted(params.format)} format.`;
		case "enum":
			return "Must be one of the allowed values.";
		case "const":
			return "Must equal the declared constant.";
		case "minimum":
			return `Must be greater than or equal to ${String(params.limit)}.`;
		case "maximum":
			return `Must be less than or equal to ${String(params.limit)}.`;
		case "exclusiveMinimum":
			return `Must be greater than ${String(params.limit)}.`;
		case "exclusiveMaximum":
			return `Must be less than ${String(params.limit)}.`;
		case "multipleOf":
			return `Must be a multiple of ${String(params.multipleOf)}.`;
		case "if":
			return `Must satisfy the ${quoted(params.failingKeyword)} conditional branch.`;
		default:
			return `Does not satisfy JSON Schema keyword ${quoted(error.keyword)}.`;
	}
}

function fixedIssues(code: string, message: string): readonly ValidationIssue[] {
	return Object.freeze([
		Object.freeze({
			code,
			message,
			severity: "error" as const,
			path: Object.freeze({ namespace: "data" as const, segments: Object.freeze([]) }),
			source: issueSource(),
		}),
	]);
}

function issueSource(): ValidationIssue["source"] {
	return Object.freeze({ origin: "json-schema-adapter", validatorId, adapterId });
}

function fixedEntry(issues: readonly ValidationIssue[]): CacheEntry {
	return validatorEntry(() => issues);
}

function validatorEntry(validator: DemoValidator): CacheEntry {
	return Object.freeze({ validator, list: Object.freeze([validator]) });
}

function quoted(value: unknown): string {
	return JSON.stringify(String(value));
}

function issueKey(issue: ValidationIssue): string {
	return JSON.stringify([issue.path.segments, issue.code, issue.message]);
}

function compareIssues(left: ValidationIssue, right: ValidationIssue): number {
	const leftKey = issueKey(left);
	const rightKey = issueKey(right);
	return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}
