import type { Segment } from "./contracts.js";
import { type OwnDataEntry, inspectDataContainer } from "./data-container.js";
import { ExpressionError } from "./result.js";

const MAX_ARRAY_INDEX = 2 ** 32 - 2;
const CANONICAL_INDEX = /^(?:0|[1-9][0-9]*)$/;

function arrayIndex(segment: Segment): number {
	if (typeof segment === "number") {
		if (!Number.isInteger(segment) || segment < 0 || segment > MAX_ARRAY_INDEX || Object.is(segment, -0)) {
			throw new ExpressionError("denied");
		}
		return segment;
	}
	if (!CANONICAL_INDEX.test(segment)) throw new ExpressionError("denied");
	const index = Number(segment);
	if (!Number.isInteger(index) || index > MAX_ARRAY_INDEX) throw new ExpressionError("denied");
	return index;
}

function entry(entries: readonly OwnDataEntry[], key: string): OwnDataEntry | undefined {
	return entries.find(([name]) => name === key);
}

function targetEntry(parent: object, segment: Segment, final: boolean): OwnDataEntry | undefined {
	const entries = inspectDataContainer(parent);
	if (!Array.isArray(parent)) return entry(entries, String(segment));
	const index = arrayIndex(segment);
	if (index > entries.length || (!final && index === entries.length)) throw new ExpressionError("missing");
	return index === entries.length ? undefined : entries[index];
}

/** Validates an immutable write path without reading properties through accessors. */
export function validateWriteTarget(root: unknown, segments: readonly Segment[]): object {
	if (!segments.length) throw new ExpressionError("read-only");
	let current = root;
	for (let index = 0; index < segments.length; index++) {
		if (current === null || typeof current !== "object") throw new ExpressionError("missing");
		const final = index === segments.length - 1;
		const selected = targetEntry(current, segments[index], final);
		if (!selected) {
			if (final && !Array.isArray(current)) return current;
			if (final && Array.isArray(current)) return current;
			throw new ExpressionError("missing");
		}
		if (final) return current;
		current = selected[1];
	}
	throw new ExpressionError("missing");
}
