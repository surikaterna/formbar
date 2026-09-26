import type { FormApi } from "./contracts.js";
import type { FormStateCapture } from "./state.js";
import type { FormStore } from "./store.js";
import type { SubmitAdapterProjection } from "./submit-adapter-contract.js";

type Supplier = (
	capture: FormStateCapture<unknown, unknown>,
	signal: AbortSignal,
) => SubmitAdapterProjection | undefined;
const suppliers = new WeakMap<FormApi<unknown, unknown>, Supplier>();
const stores = new WeakMap<object, FormStore<unknown, unknown>>();

export function registerBoundSubmitStore<TData, TUi>(form: FormApi<TData, TUi>, store: FormStore<TData, TUi>): void {
	stores.set(form, store as unknown as FormStore<unknown, unknown>);
}

export function boundSubmitStore(form: FormApi<unknown, unknown>): FormStore<unknown, unknown> | undefined {
	return stores.get(form);
}

/** Private factory registration; the caller's adapter is never an ownership authority. */
export function registerBoundSubmitSupplier(form: FormApi<unknown, unknown>, supplier: Supplier): void {
	const previous = suppliers.get(form);
	if (previous && previous !== supplier) throw new Error("conflicting bound supplier");
	suppliers.set(form, supplier);
}

export function boundSubmitSupplier(form: FormApi<unknown, unknown>): Supplier | undefined {
	return suppliers.get(form);
}
