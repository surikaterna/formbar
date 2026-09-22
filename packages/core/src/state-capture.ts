import { structuredEqual } from "./equality.js";
import type { CanonicalPath } from "./path.js";
import type { FormState, FormStateCapture } from "./state.js";

export function createFormStateCapture<TData, TUi>(
	state: FormState<TData, TUi>,
	initialData: TData,
	initialUiState: TUi,
): FormStateCapture<TData, TUi> {
	return Object.freeze({
		state,
		isFormDirty: () => !structuredEqual(state.data, initialData),
		isFieldDirty: (path: CanonicalPath) => {
			const currentRoot = path.namespace === "data" ? state.data : state.uiState;
			const initialRoot = path.namespace === "data" ? initialData : initialUiState;
			return !structuredEqual(readPath(currentRoot, path), readPath(initialRoot, path));
		},
	});
}

function readPath(root: unknown, path: CanonicalPath): unknown {
	let current = root;
	for (const segment of path.segments) {
		if (current === null || current === undefined) return undefined;
		current = (current as Record<string | number, unknown>)[segment];
	}
	return current;
}
