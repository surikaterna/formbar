import type { ValidationIssue, ValidatorFn } from "@formbar/core";
import addFormats from "ajv-formats";
import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";

const adapterId = "json-schema-adapter";
const validatorId = "json-schema-draft-2020-12";
const emptyIssues: readonly ValidationIssue[] = Object.freeze([]);
const validators = new WeakMap<object, ValidatorFn<Record<string, unknown>, Record<string, never>>>();
const validatorLists = new WeakMap<object, readonly ValidatorFn<Record<string, unknown>, Record<string, never>>[]>();

const ajv = new Ajv2020({ allErrors: true, messages: false, strict: false, validateFormats: true });
addFormats(ajv, { formats: ["date", "email", "uri"] });
ajv.addFormat("tel", true);

export function createJsonSchemaValidator(
	schema: Readonly<Record<string, unknown>>,
): ValidatorFn<Record<string, unknown>, Record<string, never>> {
	const cached = validators.get(schema);
	if (cached) return cached;
	const validate = ajv.compile(schema) as ValidateFunction<Record<string, unknown>>;
	const validator: ValidatorFn<Record<string, unknown>, Record<string, never>> = ({ data }) => {
		if (validate(data)) return emptyIssues;
		return adaptJsonSchemaErrors(validate.errors ?? []);
	};
	validators.set(schema, validator);
	return validator;
}

export function createJsonSchemaValidators(
	schema: Readonly<Record<string, unknown>>,
): readonly ValidatorFn<Record<string, unknown>, Record<string, never>>[] {
	const cached = validatorLists.get(schema);
	if (cached) return cached;
	const list = Object.freeze([createJsonSchemaValidator(schema)]);
	validatorLists.set(schema, list);
	return list;
}

export function adaptJsonSchemaErrors(errors: readonly ErrorObject[]): readonly ValidationIssue[] {
	const issues = errors.map(toValidationIssue);
	const unique = new Map(issues.map((issue) => [issueKey(issue), issue]));
	return Object.freeze([...unique.values()].sort(compareIssues));
}

function toValidationIssue(error: ErrorObject): ValidationIssue {
	return Object.freeze({
		code: `json-schema.${error.keyword}`,
		message: issueMessage(error),
		severity: "error" as const,
		path: Object.freeze({ namespace: "data" as const, segments: Object.freeze(errorSegments(error)) }),
		source: Object.freeze({ origin: adapterId as "json-schema-adapter", validatorId, adapterId }),
	});
}

function errorSegments(error: ErrorObject): (string | number)[] {
	const segments = pointerSegments(error.instancePath);
	if (error.keyword === "required" && typeof error.params.missingProperty === "string") {
		segments.push(error.params.missingProperty);
	}
	if (error.keyword === "additionalProperties" && typeof error.params.additionalProperty === "string") {
		segments.push(error.params.additionalProperty);
	}
	return segments;
}

function pointerSegments(pointer: string): (string | number)[] {
	if (!pointer) return [];
	return pointer
		.slice(1)
		.split("/")
		.map((token) => {
			const segment = token.replaceAll("~1", "/").replaceAll("~0", "~");
			return /^(0|[1-9]\d*)$/.test(segment) ? Number(segment) : segment;
		});
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
