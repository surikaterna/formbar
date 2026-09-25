import type { FieldMetaEntry } from "./state.js";
import type { FormStore } from "./store.js";
import { publishOwnedMetadata } from "./store.js";

export function markListenerTriggers<TData, TUi>(store: FormStore<TData, TUi>, paths: readonly string[]): void {
	if (paths.length === 0) return;
	if (store.isOwnedSchedulingMode()) {
		const fieldMeta = { ...store.getState().fieldMeta } as Record<string, FieldMetaEntry>;
		for (const path of paths) {
			const existing = fieldMeta[path];
			fieldMeta[path] = {
				touched: existing?.touched ?? false,
				isValidating: existing?.isValidating ?? false,
				dirty: existing?.dirty ?? false,
				listenerTriggered: true,
			};
		}
		publishOwnedMetadata(store, { kind: "fieldMeta", entries: fieldMeta });
		return;
	}
	const tx = store.beginTransaction();
	tx.mutate((draft) => {
		const fieldMeta = { ...draft.fieldMeta } as Record<string, FieldMetaEntry>;
		for (const path of paths) {
			const existing = fieldMeta[path];
			fieldMeta[path] = {
				touched: existing?.touched ?? false,
				isValidating: existing?.isValidating ?? false,
				dirty: existing?.dirty ?? false,
				listenerTriggered: true,
			};
		}
		return { ...draft, fieldMeta };
	});
	store.commitTransaction(tx);
}
