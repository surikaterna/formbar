import { boundSubmitStore, boundSubmitSupplier } from "./bound-submit-supplier.js";
import type { FormApi } from "./contracts.js";

const enabled = new WeakSet<object>();

/** Private integration switch. A naked form or caller-shaped adapter cannot enable omission. */
export function activateBoundSubmit(form: FormApi<unknown, unknown>): void {
	if (!boundSubmitStore(form) || !boundSubmitSupplier(form) || form.isDisposed())
		throw new Error("BOUND_SUBMIT_UNAVAILABLE");
	enabled.add(form);
}

export function isBoundSubmitActive(form: FormApi<unknown, unknown>): boolean {
	return enabled.has(form);
}
