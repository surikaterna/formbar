import type { FieldMetaEntry } from "./state.js";

/**
 * Shift fieldMeta keys for array children after insert/remove.
 * delta = -1 for remove (drops entry at fromIndex, shifts subsequent down).
 * delta = +1 for insert (shifts entries at and after fromIndex up).
 */
export function shiftFieldMeta(
	fieldMeta: Readonly<Record<string, FieldMetaEntry>>,
	basePath: string,
	fromIndex: number,
	delta: number,
): Record<string, FieldMetaEntry> {
	const prefix = `${basePath}.`;
	const result: Record<string, FieldMetaEntry> = {};
	for (const [key, entry] of Object.entries(fieldMeta)) {
		if (!key.startsWith(prefix)) {
			result[key] = entry;
			continue;
		}
		const suffix = key.slice(prefix.length);
		const dotIdx = suffix.indexOf(".");
		const indexStr = dotIdx === -1 ? suffix : suffix.slice(0, dotIdx);
		const idx = Number(indexStr);
		if (Number.isNaN(idx)) {
			result[key] = entry;
			continue;
		}
		if (delta < 0 && idx === fromIndex) continue;
		if (idx >= fromIndex) {
			const newIdx = idx + delta;
			const rest = dotIdx === -1 ? "" : suffix.slice(dotIdx);
			result[`${basePath}.${newIdx}${rest}`] = entry;
		} else {
			result[key] = entry;
		}
	}
	return result;
}

/** Move one complete array-item metadata subtree and reindex intervening items. */
export function moveFieldMeta(
	fieldMeta: Readonly<Record<string, FieldMetaEntry>>,
	basePath: string,
	fromIndex: number,
	toIndex: number,
): Record<string, FieldMetaEntry> {
	const prefix = `${basePath}.`;
	const result: Record<string, FieldMetaEntry> = {};
	for (const [key, entry] of Object.entries(fieldMeta)) {
		if (!key.startsWith(prefix)) {
			result[key] = entry;
			continue;
		}
		const suffix = key.slice(prefix.length);
		const dotIndex = suffix.indexOf(".");
		const indexText = dotIndex === -1 ? suffix : suffix.slice(0, dotIndex);
		const index = Number(indexText);
		if (!Number.isSafeInteger(index)) {
			result[key] = entry;
			continue;
		}
		const nextIndex = movedIndex(index, fromIndex, toIndex);
		const rest = dotIndex === -1 ? "" : suffix.slice(dotIndex);
		result[`${basePath}.${nextIndex}${rest}`] = entry;
	}
	return result;
}

function movedIndex(index: number, fromIndex: number, toIndex: number): number {
	if (index === fromIndex) return toIndex;
	if (fromIndex < toIndex && index > fromIndex && index <= toIndex) return index - 1;
	if (fromIndex > toIndex && index >= toIndex && index < fromIndex) return index + 1;
	return index;
}

/** Remove all fieldMeta entries that are children of basePath. */
export function clearChildFieldMeta(
	fieldMeta: Readonly<Record<string, FieldMetaEntry>>,
	basePath: string,
): Record<string, FieldMetaEntry> {
	const prefix = `${basePath}.`;
	return Object.fromEntries(Object.entries(fieldMeta).filter(([key]) => !key.startsWith(prefix)));
}

/** Swap fieldMeta entries for two array indices under basePath. */
export function swapFieldMeta(
	fieldMeta: Readonly<Record<string, FieldMetaEntry>>,
	basePath: string,
	indexA: number,
	indexB: number,
): Record<string, FieldMetaEntry> {
	const prefixA = `${basePath}.${indexA}`;
	const prefixB = `${basePath}.${indexB}`;
	const result: Record<string, FieldMetaEntry> = {};
	for (const [key, entry] of Object.entries(fieldMeta)) {
		if (key === prefixA || key.startsWith(`${prefixA}.`)) {
			result[`${prefixB}${key.slice(prefixA.length)}`] = entry;
		} else if (key === prefixB || key.startsWith(`${prefixB}.`)) {
			result[`${prefixA}${key.slice(prefixB.length)}`] = entry;
		} else {
			result[key] = entry;
		}
	}
	return result;
}
