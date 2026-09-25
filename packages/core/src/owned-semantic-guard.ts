import type { FormState } from "./state.js";
import { snapshotOwnership } from "./store.js";

/** A metadata notification does not revoke the captured semantic state. */
export function ownedSemanticGuard<TData, TUi>(getState: () => FormState<TData, TUi>): () => boolean {
	const initial = getState();
	const baseline = snapshotOwnership(initial);
	return () => {
		if (!baseline?.owned) return true;
		const state = getState();
		const now = snapshotOwnership(state);
		return (
			now?.store === baseline.store &&
			now.write === baseline.write &&
			now.epoch === baseline.epoch &&
			now.failure === baseline.failure &&
			state.meta.stage === initial.meta.stage
		);
	};
}
