import { ArbiterError, ArbiterErrorCode } from "@arbitre/core";
import { type FieldPolicyInput, parsePath } from "@formbar/core";

const OUTPUT_ROOT = "$formbar.fieldPolicy";
const OUTPUT_ID = /^[A-Za-z][A-Za-z0-9_-]*$/;
const POLICY_KEYS = new Set<PropertyKey>(["path", "visible", "disabled", "readOnly", "required", "label"]);
const BOOLEAN_KEYS = ["visible", "disabled", "readOnly", "required"] as const;
const UNSAFE_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);
const INTEGER_SEGMENT = /^(?:0|[1-9]\d*)$/;

function outputError(message: string, outputId?: string): never {
	throw new ArbiterError(ArbiterErrorCode.RULE_COMPILATION_FAILED, message, {
		details: outputId === undefined ? { root: OUTPUT_ROOT } : { root: OUTPUT_ROOT, outputId },
	});
}

function pathError(message: string, outputId: string, path: unknown): never {
	throw new ArbiterError(ArbiterErrorCode.INVALID_PATH, message, {
		details: { root: OUTPUT_ROOT, outputId, path },
	});
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	try {
		const prototype = Object.getPrototypeOf(value);
		return prototype === Object.prototype || prototype === null;
	} catch {
		return false;
	}
}

function ownDataKeys(value: Record<string, unknown>, outputId?: string): string[] {
	let descriptors: PropertyDescriptorMap;
	try {
		descriptors = Object.getOwnPropertyDescriptors(value);
	} catch {
		return outputError("Arbiter field policy output must be inspectable", outputId);
	}
	for (const key of Reflect.ownKeys(descriptors)) {
		const descriptor = descriptors[key as keyof PropertyDescriptorMap];
		if (typeof key !== "string" || !descriptor?.enumerable || !("value" in descriptor)) {
			return outputError("Arbiter field policy output requires enumerable data properties", outputId);
		}
	}
	return Object.keys(descriptors);
}

function normalizedPathKey(path: unknown, outputId: string): string {
	if (typeof path !== "string" || !path.startsWith("/") || path === "/") {
		return pathError(`Field policy output "${outputId}" path must be a non-empty RFC-6901 pointer`, outputId, path);
	}
	let segments: readonly (string | number)[];
	try {
		segments = parsePath(path).segments;
	} catch {
		return pathError(`Field policy output "${outputId}" has an invalid RFC-6901 pointer`, outputId, path);
	}
	if (segments.some((segment) => segment === "" || segment === "*" || UNSAFE_SEGMENTS.has(String(segment)))) {
		return pathError(`Field policy output "${outputId}" has an unsupported target path`, outputId, path);
	}
	const normalized = segments.map((segment) => (INTEGER_SEGMENT.test(String(segment)) ? Number(segment) : segment));
	if (normalized.some((segment) => typeof segment === "number" && !Number.isSafeInteger(segment))) {
		return pathError(`Field policy output "${outputId}" has an unsafe array index`, outputId, path);
	}
	return JSON.stringify(normalized);
}

function decodeRecord(
	value: unknown,
	outputId: string,
): { readonly input: FieldPolicyInput; readonly pathKey: string } {
	if (!isPlainRecord(value)) outputError(`Field policy output "${outputId}" must be a record`, outputId);
	const keys = ownDataKeys(value, outputId);
	for (const key of keys) {
		if (!POLICY_KEYS.has(key)) outputError(`Field policy output "${outputId}" has unknown property "${key}"`, outputId);
	}
	if (!keys.includes("path")) outputError(`Field policy output "${outputId}" requires "path"`, outputId);
	if (!keys.some((key) => key !== "path")) {
		outputError(`Field policy output "${outputId}" requires at least one policy property`, outputId);
	}
	for (const key of BOOLEAN_KEYS) {
		if (keys.includes(key) && typeof value[key] !== "boolean") {
			outputError(`Field policy output "${outputId}" property "${key}" must be boolean`, outputId);
		}
	}
	if (keys.includes("label") && typeof value.label !== "string") {
		outputError(`Field policy output "${outputId}" property "label" must be a string`, outputId);
	}
	const pathKey = normalizedPathKey(value.path, outputId);
	return { input: value as unknown as FieldPolicyInput, pathKey };
}

export function readFieldPolicyOutput(session: { getPath(path: string): unknown }): readonly FieldPolicyInput[] {
	const root = session.getPath(OUTPUT_ROOT);
	if (root === undefined) return [];
	if (!isPlainRecord(root)) outputError("Arbiter field policy output root must be a record");
	const outputIds = ownDataKeys(root).sort();
	const seen = new Map<string, string>();
	return outputIds.map((outputId) => {
		if (!OUTPUT_ID.test(outputId)) outputError(`Invalid field policy output ID "${outputId}"`, outputId);
		const decoded = decodeRecord(root[outputId], outputId);
		const duplicate = seen.get(decoded.pathKey);
		if (duplicate) {
			pathError(
				`Field policy outputs "${duplicate}" and "${outputId}" target the same path`,
				outputId,
				decoded.input.path,
			);
		}
		seen.set(decoded.pathKey, outputId);
		return decoded.input;
	});
}
