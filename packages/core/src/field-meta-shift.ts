import { parsePath, toDot, toPointer } from "./path-parser.js";
import type { CanonicalPath, CanonicalSegment } from "./path.js";
import type { FieldMetaEntry } from "./state.js";

interface ParsedMetaPath extends CanonicalPath {
	readonly pointer: boolean;
}

type IndexMapper = (index: number) => number | undefined;

export function shiftFieldMeta(
	fieldMeta: Readonly<Record<string, FieldMetaEntry>>,
	basePath: string,
	fromIndex: number,
	delta: number,
): Record<string, FieldMetaEntry> {
	return reindexFieldMeta(fieldMeta, basePath, (index) => {
		if (delta < 0 && index === fromIndex) return undefined;
		return index >= fromIndex ? index + delta : index;
	});
}

export function moveFieldMeta(
	fieldMeta: Readonly<Record<string, FieldMetaEntry>>,
	basePath: string,
	fromIndex: number,
	toIndex: number,
): Record<string, FieldMetaEntry> {
	return reindexFieldMeta(fieldMeta, basePath, (index) => movedIndex(index, fromIndex, toIndex));
}

export function clearChildFieldMeta(
	fieldMeta: Readonly<Record<string, FieldMetaEntry>>,
	basePath: string,
): Record<string, FieldMetaEntry> {
	const base = parseMetaPath(basePath);
	if (!base) return { ...fieldMeta };
	return Object.fromEntries(
		Object.entries(fieldMeta).filter(([key]) => {
			const candidate = parseMetaPath(key);
			return !candidate || !isDescendant(candidate, base);
		}),
	);
}

export function swapFieldMeta(
	fieldMeta: Readonly<Record<string, FieldMetaEntry>>,
	basePath: string,
	indexA: number,
	indexB: number,
): Record<string, FieldMetaEntry> {
	return reindexFieldMeta(fieldMeta, basePath, (index) => {
		if (index === indexA) return indexB;
		if (index === indexB) return indexA;
		return index;
	});
}

function reindexFieldMeta(
	fieldMeta: Readonly<Record<string, FieldMetaEntry>>,
	basePath: string,
	mapIndex: IndexMapper,
): Record<string, FieldMetaEntry> {
	const base = parseMetaPath(basePath);
	if (!base) return { ...fieldMeta };
	const result: Record<string, FieldMetaEntry> = {};
	for (const [key, entry] of Object.entries(fieldMeta)) {
		const candidate = parseMetaPath(key);
		if (!candidate) {
			result[key] = entry;
			continue;
		}
		const index = childIndex(candidate, base);
		if (index === undefined) {
			result[key] = entry;
			continue;
		}
		const next = mapIndex(index);
		if (next === undefined) continue;
		const segments = [...candidate.segments];
		segments[base.segments.length] = next;
		result[formatMetaPath(candidate, segments)] = entry;
	}
	return result;
}

function parseMetaPath(value: string): ParsedMetaPath | undefined {
	try {
		const parsed = parsePath(value);
		return {
			namespace: parsed.namespace,
			segments: parsed.segments.map(normalizeSegment),
			pointer: value === "" || value.startsWith("/"),
		};
	} catch {
		return undefined;
	}
}

function normalizeSegment(segment: CanonicalSegment): CanonicalSegment {
	return typeof segment === "string" && /^(?:0|[1-9]\d*)$/.test(segment) ? Number(segment) : segment;
}

function childIndex(candidate: ParsedMetaPath, base: ParsedMetaPath): number | undefined {
	if (!isDescendant(candidate, base)) return undefined;
	const index = candidate.segments[base.segments.length];
	return typeof index === "number" && Number.isSafeInteger(index) && index >= 0 ? index : undefined;
}

function isDescendant(candidate: ParsedMetaPath, base: ParsedMetaPath): boolean {
	return (
		candidate.namespace === base.namespace &&
		candidate.segments.length > base.segments.length &&
		base.segments.every((segment, index) => segment === candidate.segments[index])
	);
}

function formatMetaPath(path: ParsedMetaPath, segments: readonly CanonicalSegment[]): string {
	const canonical = { namespace: path.namespace, segments } as const;
	return path.pointer ? toPointer(canonical) : toDot(canonical);
}

function movedIndex(index: number, fromIndex: number, toIndex: number): number {
	if (index === fromIndex) return toIndex;
	if (fromIndex < toIndex && index > fromIndex && index <= toIndex) return index - 1;
	if (fromIndex > toIndex && index >= toIndex && index < fromIndex) return index + 1;
	return index;
}
