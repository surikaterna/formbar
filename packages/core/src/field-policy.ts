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
	let parsed: { readonly namespace: "data" | "ui"; readonly segments: readonly CanonicalSegment[] };
	if (typeof input === "string") parsed = parsePath(input);
	else if (Array.isArray(input)) parsed = { namespace: "data", segments: input };
	else parsed = input as AbsoluteDataPath;
	if (parsed.namespace !== "data") throw new Error("Field policy paths must use the data namespace");
	if (parsed.segments.length === 0) throw new Error("Field policy paths must not be empty");
	const segments = Object.freeze(parsed.segments.map(normalizeSegment));
	return Object.freeze({ namespace: "data", segments });
}

function pathKey(path: AbsoluteDataPath): string {
	return JSON.stringify(path.segments);
}

export function fieldMetaKey(path: AbsoluteDataPath): string {
	const dotSafe = path.segments.every((segment) => typeof segment === "number" || !segment.includes("."));
	if (dotSafe) return path.segments.join(".");
	return `/${path.segments.map((segment) => String(segment).replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`;
}

export function normalizePolicySnapshot(
	producerId: string,
	inputs: readonly FieldPolicyInput[],
): readonly FieldPolicyContribution[] {
	const seen = new Set<string>();
	return Object.freeze(
		inputs.map(({ path: input, ...policy }) => {
			const path = normalizeDataPath(input);
			const key = pathKey(path);
			if (seen.has(key)) throw new Error(`Duplicate field policy path from plugin "${producerId}": ${key}`);
			seen.add(key);
			return Object.freeze({ ...policy, path, producerId });
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
