import type { FormApi } from "./contracts.js";
import { inspect } from "./owned-issue-snapshot.js";
import { invalidateScopedSync } from "./scoped-sync.js";
import { type FormStore, ownStoreBeforeScheduling } from "./store.js";

const stores = new WeakMap<object, () => void>();

/** Register the one authoritative store behind a core-created form. */
export function bindOwnedSchedulingBoundary<TData, TUi>(
	form: FormApi<TData, TUi>,
	store: FormStore<TData, TUi>,
	initial: { readonly data: TData; readonly uiState: TUi },
): void {
	stores.set(form, () => {
		if (store.isOwnedSchedulingMode()) return;
		inspect(initial, new Set(), { value: 0 }, 0);
		ownStoreBeforeScheduling(store, () => invalidateScopedSync(form));
	});
}

/** Trusted host activation; no public createForm option or second draft store. */
export function activateOwnedSchedulingBoundary(form: object): void {
	const activate = stores.get(form);
	if (!activate) throw new Error("OWNED_STATE_UNSUPPORTED");
	activate();
}
