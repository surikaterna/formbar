import { structuredEqual } from "./equality.js";
import type { CanonicalSegment } from "./path.js";
import type { ScopedAsyncField } from "./scoped-async.js";

export interface Observation {
	readonly binding: readonly CanonicalSegment[];
	readonly value: unknown;
	readonly arrays: readonly { readonly reference: unknown; readonly snapshot: unknown }[];
	readonly valid: boolean;
}

export function observe(field: ScopedAsyncField, data: unknown): Observation {
	const binding = field.binding.segments;
	const arrays: { readonly reference: unknown; readonly snapshot: unknown }[] = [];
	let value = data;
	try {
		for (const segment of binding) {
			if (value === null || typeof value !== "object" || !Object.hasOwn(value, segment))
				return { binding, value: undefined, arrays: [], valid: false };
			if (Array.isArray(value)) arrays.push({ reference: value, snapshot: structuredClone(value) });
			value = (value as Record<string | number, unknown>)[segment];
		}
		return { binding, value: structuredClone(value), arrays, valid: value !== undefined };
	} catch {
		return { binding, value: undefined, arrays: [], valid: false };
	}
}

export function observationCurrent(observation: Observation | undefined, data: unknown): boolean {
	if (!observation?.valid) return false;
	let value = data;
	let index = 0;
	try {
		for (const segment of observation.binding) {
			if (value === null || typeof value !== "object" || !Object.hasOwn(value, segment)) return false;
			if (Array.isArray(value)) {
				const array = observation.arrays[index++];
				if (!array || array.reference !== value || !structuredEqual(array.snapshot, value)) return false;
			}
			value = (value as Record<string | number, unknown>)[segment];
		}
		return structuredEqual(observation.value, value);
	} catch {
		return false;
	}
}
