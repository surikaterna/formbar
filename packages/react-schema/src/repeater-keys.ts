import type { StructuralOperation } from "./repeater-coordinator.js";

export interface RowKeyState {
	readonly keys: readonly string[];
	readonly counter: number;
}

export function initialRowKeys(instanceKey: string, length: number, generation = 0): RowKeyState {
	return {
		keys: Object.freeze(
			Array.from({ length }, (_, index) => `row:${instanceKey}:generation:${generation}:index:${index}`),
		),
		counter: length,
	};
}

export function applyRowOperation(state: RowKeyState, operation: StructuralOperation): RowKeyState {
	const keys = [...state.keys];
	let counter = state.counter;
	const allocate = () => `row:new:${counter++}`;
	if (operation.type === "append") keys.push(allocate());
	else if (operation.type === "insert") keys.splice(operation.index, 0, allocate());
	else if (operation.type === "remove") keys.splice(operation.index, 1);
	else if (operation.type === "move") {
		const [key] = keys.splice(operation.from, 1);
		if (key !== undefined) keys.splice(operation.to, 0, key);
	} else {
		[keys[operation.from], keys[operation.to]] = [keys[operation.to], keys[operation.from]];
	}
	return { keys: Object.freeze(keys), counter };
}
