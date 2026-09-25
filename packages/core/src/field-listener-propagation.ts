import type { createListenerRegistry } from "./listener-registry.js";
import type { FieldMetaEntry, FormState } from "./state.js";
import type { FormStore } from "./store.js";

export function propagateFieldListeners<TData, TUi>(
	store: FormStore<TData, TUi>,
	listeners: ReturnType<typeof createListenerRegistry>,
	pathKey: string,
	trigger: "change" | "blur",
): void {
	const targets = listeners.getListeners(pathKey, trigger);
	if (targets.length === 0) return;
	const tx = store.beginTransaction();
	tx.mutate((draft: FormState<TData, TUi>) => {
		const fieldMeta = { ...draft.fieldMeta } as Record<string, FieldMetaEntry>;
		for (const target of targets) {
			const existing = fieldMeta[target.path];
			fieldMeta[target.path] = {
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
