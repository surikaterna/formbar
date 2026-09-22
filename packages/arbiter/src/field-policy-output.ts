import { ArbiterError, ArbiterErrorCode } from "@arbitre/core";
import { type FieldPolicyInput, parsePath } from "@formbar/core";

const OUTPUT_ROOT = "$formbar.fieldPolicy";
const OUTPUT_ID = /^[A-Za-z][A-Za-z0-9_-]*$/;
const POLICY_KEYS = new Set<PropertyKey>(["path", "visible", "disabled", "readOnly", "required", "label"]);
const BOOLEAN_KEYS = ["visible", "disabled", "readOnly", "required"] as const;
const UNSAFE_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);
const INTEGER_SEGMENT = /^(?:0|[1-9]\d*)$/;

interface CapturedRecord {
	readonly keys: readonly string[];
	readonly values: ReadonlyMap<string, unknown>;
}

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

function captureRecord(value: unknown, outputId?: string): CapturedRecord {
	if (value === null || typeof value !== "object") {
		return outputError("Arbiter field policy output must be a plain data record", outputId);
	}
	let array: boolean;
	let prototype: object | null;
	let keys: readonly PropertyKey[];
	const descriptors = new Map<PropertyKey, PropertyDescriptor | undefined>();
	try {
		array = Array.isArray(value);
		prototype = Reflect.getPrototypeOf(value);
		keys = Reflect.ownKeys(value);
		for (const key of keys) descriptors.set(key, Reflect.getOwnPropertyDescriptor(value, key));
	} catch {
		return outputError("Arbiter field policy output must be inspectable", outputId);
	}
	if (array) return outputError("Arbiter field policy output must be a plain data record", outputId);
	if (prototype !== Object.prototype && prototype !== null) {
		return outputError("Arbiter field policy output must use a plain prototype", outputId);
	}
	const values = new Map<string, unknown>();
	for (const key of keys) {
		const descriptor = descriptors.get(key);
		if (typeof key !== "string" || !descriptor?.enumerable || !("value" in descriptor)) {
			return outputError("Arbiter field policy output requires enumerable data properties", outputId);
		}
		values.set(key, descriptor.value);
	}
	return { keys: [...values.keys()], values };
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
	const { keys, values } = captureRecord(value, outputId);
	for (const key of keys) {
		if (!POLICY_KEYS.has(key)) outputError(`Field policy output "${outputId}" has unknown property "${key}"`, outputId);
	}
	if (!keys.includes("path")) outputError(`Field policy output "${outputId}" requires "path"`, outputId);
	if (!keys.some((key) => key !== "path")) {
		outputError(`Field policy output "${outputId}" requires at least one policy property`, outputId);
	}
	for (const key of BOOLEAN_KEYS) {
		if (values.has(key) && typeof values.get(key) !== "boolean") {
			outputError(`Field policy output "${outputId}" property "${key}" must be boolean`, outputId);
		}
	}
	if (values.has("label") && typeof values.get("label") !== "string") {
		outputError(`Field policy output "${outputId}" property "label" must be a string`, outputId);
	}
	const path = values.get("path");
	const pathKey = normalizedPathKey(path, outputId);
	const input: FieldPolicyInput = Object.freeze({
		path: path as string,
		...(values.has("visible") ? { visible: values.get("visible") as boolean } : {}),
		...(values.has("disabled") ? { disabled: values.get("disabled") as boolean } : {}),
		...(values.has("readOnly") ? { readOnly: values.get("readOnly") as boolean } : {}),
		...(values.has("required") ? { required: values.get("required") as boolean } : {}),
		...(values.has("label") ? { label: values.get("label") as string } : {}),
	});
	return { input, pathKey };
}

export function readFieldPolicyOutput(session: { getPath(path: string): unknown }): readonly FieldPolicyInput[] {
	let root: unknown;
	try {
		root = session.getPath(OUTPUT_ROOT);
	} catch (error) {
		if (error instanceof ArbiterError) throw error;
		return outputError("Arbiter field policy output root could not be read");
	}
	if (root === undefined) return Object.freeze([]);
	const captured = captureRecord(root);
	const outputIds = [...captured.keys].sort();
	const seen = new Map<string, string>();
	const inputs = outputIds.map((outputId) => {
		if (!OUTPUT_ID.test(outputId)) outputError(`Invalid field policy output ID "${outputId}"`, outputId);
		const decoded = decodeRecord(captured.values.get(outputId), outputId);
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
	return Object.freeze(inputs);
}
