import { structuredEqual } from "./equality.js";
import { inspect } from "./owned-issue-snapshot.js";
import type { FormStateCapture } from "./state.js";
import { snapshotOwnership } from "./store.js";

function witness(data: unknown, uiState: unknown, policy: unknown) {
	return inspect({ data, uiState, policy }, new Set(), { value: 0 }, 0);
}

function matches(value: ReturnType<typeof witness>, data: unknown, ui: unknown, policy: unknown): boolean {
	try {
		return structuredEqual(value, witness(data, ui, policy));
	} catch {
		return false;
	}
}

/** One scheduling-generation baseline; the original mutable alias remains checked after detachment. */
export function scopedCaptureReceipt<TData, TUi>(
	capture: FormStateCapture<TData, TUi>,
): (state: {
	readonly data: TData;
	readonly uiState: TUi;
	readonly fieldPolicy: typeof capture.state.fieldPolicy;
	readonly meta: typeof capture.state.meta;
}) => boolean {
	const origin = capture.state;
	const owner = snapshotOwnership(origin);
	const baseline = owner?.owned ? undefined : witness(origin.data, origin.uiState, origin.fieldPolicy);
	const stage = origin.meta.stage;
	let acceptedEpoch = owner?.epoch;
	return (state) => {
		const now = snapshotOwnership(state);
		if (!owner || !now || now.store !== owner.store || now.write !== owner.write || now.failure !== owner.failure)
			return false;
		if (now.owned && !owner.owned) return false;
		if (owner.owned) {
			return now.owned && now.epoch === owner.epoch && origin.meta.stage === stage && state.meta.stage === stage;
		}
		if (now.epoch !== acceptedEpoch) {
			if (acceptedEpoch !== owner.epoch || now.epoch !== owner.epoch + 1) return false;
		}
		if (origin.meta.stage !== stage || state.meta.stage !== stage) return false;
		if (!baseline || !matches(baseline, origin.data, origin.uiState, origin.fieldPolicy)) return false;
		if (!matches(baseline, state.data, state.uiState, state.fieldPolicy)) return false;
		acceptedEpoch = now.epoch;
		return true;
	};
}
