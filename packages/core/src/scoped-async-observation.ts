import { structuredEqual } from "./equality.js";
import type { CanonicalSegment } from "./path.js";
import type { ScopedAsyncField } from "./scoped-async.js";

export interface Observation {
	readonly binding: readonly CanonicalSegment[];
	readonly value: unknown;
	readonly arrays: readonly ArrayObservation[];
	readonly valid: boolean;
}

interface ArrayObservation {
	readonly reference: unknown[];
	readonly snapshot: unknown;
}

export interface ObservationContext {
	readonly arrays: WeakMap<unknown[], ArrayObservation>;
}

export function observationContext(): ObservationContext {
	return { arrays: new WeakMap() };
}

export function observe(field: ScopedAsyncField, data: unknown, context: ObservationContext): Observation {
	const binding = field.binding.segments;
	const arrays: ArrayObservation[] = [];
	let value = data;
	try {
		for (const segment of binding) {
			if (value === null || typeof value !== "object" || !Object.hasOwn(value, segment))
				return { binding, value: undefined, arrays: [], valid: false };
			if (Array.isArray(value)) {
				let array = context.arrays.get(value);
				if (!array) {
					array = { reference: value, snapshot: structuredClone(value) };
					context.arrays.set(value, array);
				}
				arrays.push(array);
			}
			value = (value as Record<string | number, unknown>)[segment];
		}
		return { binding, value: structuredClone(value), arrays, valid: value !== undefined };
	} catch {
		return { binding, value: undefined, arrays: [], valid: false };
	}
}

export function observationCurrent(
	observation: Observation | undefined,
	data: unknown,
	compared: Map<object, boolean>,
): boolean {
	if (!observation?.valid) return false;
	let value = data;
	let index = 0;
	try {
		for (const segment of observation.binding) {
			if (value === null || typeof value !== "object" || !Object.hasOwn(value, segment)) return false;
			if (Array.isArray(value)) {
				const array = observation.arrays[index++];
				if (!array || array.reference !== value) return false;
				let same = compared.get(array);
				if (same === undefined) {
					same = structuredEqual(array.snapshot, value);
					compared.set(array, same);
				}
				if (!same) return false;
			}
			value = (value as Record<string | number, unknown>)[segment];
		}
		return structuredEqual(observation.value, value);
	} catch {
		return false;
	}
}
