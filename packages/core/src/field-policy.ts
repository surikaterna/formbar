import { structuredEqual } from "./equality.js";
import { parsePath } from "./path-parser.js";
import type { CanonicalSegment } from "./path.js";
import { assertSafeSegment } from "./safe-path.js";

const INTEGER_SEGMENT = /^(?:0|[1-9]\d*)$/;

export interface AbsoluteDataPath {
	readonly namespace: "data";
	readonly segments: readonly CanonicalSegment[];
}

export type DataPathInput = string | readonly CanonicalSegment[] | AbsoluteDataPath;

export interface FieldPolicy {
	readonly visible?: boolean;
	readonly disabled?: boolean;
	readonly readOnly?: boolean;
	readonly required?: boolean;
	readonly label?: string;
}

export interface FieldPolicyInput extends FieldPolicy {
	readonly path: DataPathInput;
}

export interface FieldPolicyContribution extends FieldPolicy {
	readonly path: AbsoluteDataPath;
	readonly producerId: string;
}

const POLICY_KEYS = new Set<PropertyKey>(["path", "visible", "disabled", "readOnly", "required", "label"]);

function normalizeSegment(segment: CanonicalSegment): CanonicalSegment {
	if (typeof segment === "number") {
		if (!Number.isSafeInteger(segment) || segment < 0) throw new Error(`Invalid data path index: ${segment}`);
		return segment;
	}
	if (segment.length === 0) throw new Error("Data path segments must not be empty");
	assertSafeSegment(segment);
	return INTEGER_SEGMENT.test(segment) ? Number(segment) : segment;
}

export function normalizeDataPath(input: DataPathInput): AbsoluteDataPath {
	if (input === "") throw new Error("Field policy paths must not be empty");
	let parsed: { readonly namespace: "data" | "ui"; readonly segments: readonly CanonicalSegment[] };
	if (typeof input === "string") parsed = parsePath(input);
	else if (Array.isArray(input)) parsed = { namespace: "data", segments: input };
	else parsed = input as AbsoluteDataPath;
	if (parsed.namespace !== "data") throw new Error("Field policy paths must use the data namespace");
	const segments = Object.freeze(parsed.segments.map(normalizeSegment));
	return Object.freeze({ namespace: "data", segments });
}

function pathKey(path: AbsoluteDataPath): string {
	return JSON.stringify(path.segments);
}

export function fieldMetaKey(path: AbsoluteDataPath): string {
	const dotSafe = path.segments.every((segment) => typeof segment === "number" || !segment.includes("."));
	if (path.segments[0] === "$ui") return toDataPointer(path.segments);
	if (dotSafe) return path.segments.join(".");
	return toDataPointer(path.segments);
}

function toDataPointer(segments: readonly CanonicalSegment[]): string {
	return `/${segments.map((segment) => String(segment).replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`;
}

function normalizePolicy(input: FieldPolicyInput): FieldPolicy {
	for (const key of Reflect.ownKeys(input)) {
		if (!POLICY_KEYS.has(key)) throw new Error(`Unknown field policy property: ${String(key)}`);
	}
	for (const key of ["visible", "disabled", "readOnly", "required"] as const) {
		if (input[key] !== undefined && typeof input[key] !== "boolean") {
			throw new Error(`Field policy property "${key}" must be boolean`);
		}
	}
	if (input.label !== undefined && typeof input.label !== "string") {
		throw new Error('Field policy property "label" must be a string');
	}
	return {
		...(input.visible !== undefined ? { visible: input.visible } : {}),
		...(input.disabled !== undefined ? { disabled: input.disabled } : {}),
		...(input.readOnly !== undefined ? { readOnly: input.readOnly } : {}),
		...(input.required !== undefined ? { required: input.required } : {}),
		...(input.label !== undefined ? { label: input.label } : {}),
	};
}

export function emptyFieldPolicy(): readonly FieldPolicyContribution[] {
	return Object.freeze([]);
}

export function normalizePolicySnapshot(
	producerId: string,
	inputs: readonly FieldPolicyInput[],
): readonly FieldPolicyContribution[] {
	const seen = new Set<string>();
	return Object.freeze(
		inputs.map((input) => {
			const path = normalizeDataPath(input.path);
			const key = pathKey(path);
			if (seen.has(key)) throw new Error(`Duplicate field policy path from plugin "${producerId}": ${key}`);
			seen.add(key);
			return Object.freeze({ ...normalizePolicy(input), path, producerId });
		}),
	);
}

export function replacePolicyContributions(
	current: readonly FieldPolicyContribution[],
	plugins: readonly { readonly id: string }[],
	replacements: ReadonlyMap<string, readonly FieldPolicyContribution[]>,
): readonly FieldPolicyContribution[] {
	if (replacements.size === 0) return current;
	const snapshots = new Map<string, readonly FieldPolicyContribution[]>();
	for (const contribution of current) {
		const snapshot = snapshots.get(contribution.producerId) ?? [];
		snapshots.set(contribution.producerId, [...snapshot, contribution]);
	}
	for (const [producerId, replacement] of replacements) snapshots.set(producerId, replacement);
	const next = plugins.flatMap((plugin) => snapshots.get(plugin.id) ?? []);
	return structuredEqual(current, next) ? current : Object.freeze(next);
}
