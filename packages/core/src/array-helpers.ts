import { inspectDataContainer } from "@formbar/expressions";
import type { FormDispatchResult } from "./contracts.js";
import { moveFieldMeta, shiftFieldMeta, swapFieldMeta } from "./field-meta-shift.js";
import type { FieldMetaEntry } from "./state.js";

export interface ArrayHelperDeps {
	readonly get: () => unknown;
	readonly set: (value: unknown) => FormDispatchResult;
	readonly pathKey: string;
	readonly updateFieldMeta: (updater: (meta: Record<string, FieldMetaEntry>) => Record<string, FieldMetaEntry>) => void;
}

function assertArray(val: unknown, pathKey: string): unknown[] {
	if (!Array.isArray(val)) throw new Error(`Expected array at "${pathKey}", got ${typeof val}`);
	const length = val.length;
	const entries = inspectDataContainer(val);
	if (length !== entries.length) throw new Error(`Invalid array at "${pathKey}"`);
	return entries.map((entry) => entry[1]);
}

export function createArrayHelpers(deps: ArrayHelperDeps) {
	return {
		pushValue(item: unknown): FormDispatchResult {
			const arr = assertArray(deps.get(), deps.pathKey);
			return deps.set([...arr, item]);
		},

		removeValue(index: number): FormDispatchResult {
			const arr = assertArray(deps.get(), deps.pathKey);
			const result = deps.set([...arr.slice(0, index), ...arr.slice(index + 1)]);
			if (result.ok) {
				deps.updateFieldMeta((meta) => shiftFieldMeta(meta, deps.pathKey, index, -1));
			}
			return result;
		},

		insertValue(index: number, item: unknown): FormDispatchResult {
			const arr = assertArray(deps.get(), deps.pathKey);
			const result = deps.set([...arr.slice(0, index), item, ...arr.slice(index)]);
			if (result.ok) {
				deps.updateFieldMeta((meta) => shiftFieldMeta(meta, deps.pathKey, index, 1));
			}
			return result;
		},

		moveValue(fromIndex: number, toIndex: number): FormDispatchResult {
			const arr = assertArray(deps.get(), deps.pathKey);
			const next = [...arr];
			const [moved] = next.splice(fromIndex, 1);
			next.splice(toIndex, 0, moved);
			const result = deps.set(next);
			if (result.ok) {
				deps.updateFieldMeta((meta) => moveFieldMeta(meta, deps.pathKey, fromIndex, toIndex));
			}
			return result;
		},

		swapValue(indexA: number, indexB: number): FormDispatchResult {
			const arr = assertArray(deps.get(), deps.pathKey);
			const next = [...arr];
			[next[indexA], next[indexB]] = [next[indexB], next[indexA]];
			const result = deps.set(next);
			if (result.ok) {
				deps.updateFieldMeta((meta) => swapFieldMeta(meta, deps.pathKey, indexA, indexB));
			}
			return result;
		},
	};
}
