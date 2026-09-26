import type { FormApi } from "./contracts.js";
import type { FormStateCapture, ValidationIssue } from "./state.js";
import type { FormStore } from "./store.js";
import type { SubmitAdapterProjection, SubmitStructuralWitness } from "./submit-adapter-contract.js";

export type BoundSupplier = ((
	capture: FormStateCapture<unknown, unknown>,
	signal: AbortSignal,
) => SubmitAdapterProjection | undefined) & {
	/** Original issue authority is captured before pipeline hooks, never revived by a later path. */
	readonly preflight: (
		issue: ValidationIssue,
	) => ((capture: FormStateCapture<unknown, unknown>, plan: SubmitStructuralWitness) => boolean) | undefined;
};
const suppliers = new WeakMap<FormApi<unknown, unknown>, BoundSupplier>();
const stores = new WeakMap<object, FormStore<unknown, unknown>>();

export function registerBoundSubmitStore<TData, TUi>(form: FormApi<TData, TUi>, store: FormStore<TData, TUi>): void {
	stores.set(form, store as unknown as FormStore<unknown, unknown>);
}

export function boundSubmitStore(form: FormApi<unknown, unknown>): FormStore<unknown, unknown> | undefined {
	return stores.get(form);
}

/** Private factory registration; the caller's adapter is never an ownership authority. */
export function registerBoundSubmitSupplier(form: FormApi<unknown, unknown>, supplier: BoundSupplier): void {
	const previous = suppliers.get(form);
	if (previous && previous !== supplier) throw new Error("conflicting bound supplier");
	suppliers.set(form, supplier);
}

export function boundSubmitSupplier(form: FormApi<unknown, unknown>): BoundSupplier | undefined {
	return suppliers.get(form);
}
