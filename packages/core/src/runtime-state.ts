import { computeIsSubmitting, computeIsValid } from "./convenience-flags.js";
import { emptyFieldPolicy } from "./field-policy.js";
import type { FormState } from "./state.js";
import type { FormStore } from "./store.js";

export function createRuntimeInitialState<TData, TUi>(data: TData, uiState: TUi): FormState<TData, TUi> {
	return {
		data: structuredClone(data),
		uiState: structuredClone(uiState),
		meta: { validation: { validating: false } },
		fieldMeta: {},
		fieldPolicy: emptyFieldPolicy(),
		issues: [],
	};
}

export function updateRuntimeState<TData, TUi>(
	store: FormStore<TData, TUi>,
	updater: (draft: FormState<TData, TUi>) => FormState<TData, TUi>,
): void {
	const tx = store.beginTransaction();
	tx.mutate(updater);
	store.commitTransaction(tx);
}

export function canRuntimeSubmit<TData, TUi>(state: FormState<TData, TUi>): boolean {
	return !computeIsSubmitting(state) && !state.meta.validation.validating && computeIsValid(state);
}
