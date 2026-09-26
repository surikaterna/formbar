import type { SubmitDefinitionAdapter, SubmitJson, SubmitStructuralWitness } from "./submit-adapter-contract.js";
import { checkSubmitAdapterProof } from "./submit-adapter-proof.js";
import { Boundary, add, applyEgress, clone, freeze, makeContext, unchanged } from "./submit-candidate-safety.js";
import type { CandidateEgress } from "./submit-candidate-safety.js";

type Result =
	| {
			readonly ok: true;
			readonly data: SubmitJson;
			readonly uiState: SubmitJson;
			readonly plan?: SubmitStructuralWitness;
	  }
	| { readonly ok: false; readonly code: "unsafe_candidate" | "invalid_witness" };

type OwnedState = {
	readonly data: unknown;
	readonly uiState: unknown;
	readonly fieldPolicy?: unknown;
	readonly stage?: string;
};

function captureOwned(state: OwnedState) {
	const dataDescriptor = Object.getOwnPropertyDescriptor(state, "data");
	const uiDescriptor = Object.getOwnPropertyDescriptor(state, "uiState");
	if (!dataDescriptor || !("value" in dataDescriptor) || !uiDescriptor || !("value" in uiDescriptor))
		throw new Error("state");
	const retained = new Boundary();
	const original = retained.copy(dataDescriptor.value);
	const ui = retained.copy(uiDescriptor.value);
	const policy = state.fieldPolicy === undefined ? undefined : retained.copy(state.fieldPolicy);
	const capture = Object.freeze({
		data: freeze(original),
		uiState: freeze(ui),
		...(policy === undefined ? {} : { fieldPolicy: freeze(policy) }),
		...(state.stage === undefined ? {} : { stage: state.stage }),
	});
	const blocked = new Set(retained.refs);
	blocked.add(state);
	add(blocked, clone(capture).refs);
	blocked.add(capture);
	const retainedUnchanged = () =>
		unchanged(dataDescriptor.value, original) &&
		unchanged(uiDescriptor.value, ui) &&
		(policy === undefined || unchanged(state.fieldPolicy, policy));
	return { original, ui, capture, blocked, retainedUnchanged };
}

function checkedFinal(
	original: SubmitJson,
	projection: SubmitJson,
	witness: SubmitJson,
	final: SubmitJson,
	ui: SubmitJson,
	retainPlan: boolean,
	check: () => boolean,
): Result {
	const proof = checkSubmitAdapterProof(original, projection, () => witness, clone(final).value, retainPlan);
	if (!proof.ok) return proof;
	if (!check()) throw new Error("mutation");
	return {
		ok: true,
		data: proof.data,
		uiState: freeze(clone(ui).value),
		...(proof.plan ? { plan: proof.plan } : {}),
	};
}

/** Internal one-capture seam. Trusted callbacks are not a same-realm sandbox. */
export function prepareOwnedSubmitAdapter(
	state: OwnedState,
	adapter: SubmitDefinitionAdapter,
	transforms: readonly CandidateEgress[] = [],
	checkpoint: () => boolean = () => true,
	retainPlan = false,
): Result {
	try {
		if (!checkpoint()) throw new Error("stale");
		const { original, ui, capture, blocked, retainedUnchanged } = captureOwned(state);
		const supplied = adapter(capture);
		if (!checkpoint()) throw new Error("stale");
		const captureBaseline = clone(capture).value;
		if (!unchanged(capture, captureBaseline) || !retainedUnchanged()) throw new Error("mutation");
		if (!supplied || typeof supplied !== "object") throw new Error("adapter");
		if (blocked.has(supplied)) throw new Error("alias");
		if (!("witness" in supplied)) return { ok: false, code: "invalid_witness" };
		if (Reflect.ownKeys(supplied).sort().join() !== "data,witness") throw new Error("adapter");
		if (!["data", "witness"].every((key) => "value" in (Object.getOwnPropertyDescriptor(supplied, key) ?? {})))
			throw new Error("adapter");
		const projection = clone(supplied.data, blocked);
		add(blocked, projection.refs);
		const witness = clone(supplied.witness, blocked);
		add(blocked, witness.refs);
		const snapshot = clone(supplied).value;
		const { context, snapshot: contextSnapshot } = makeContext(projection.value, ui, blocked);
		const check = () =>
			checkpoint() &&
			retainedUnchanged() &&
			unchanged(capture, captureBaseline) &&
			unchanged(supplied, snapshot) &&
			unchanged(context, contextSnapshot);
		if (!check()) throw new Error("mutation");
		const final = applyEgress(projection.value, context, transforms, blocked, check);
		if (!check()) throw new Error("mutation");
		return checkedFinal(original, projection.value, witness.value, final, ui, retainPlan, check);
	} catch {
		return { ok: false, code: "unsafe_candidate" };
	}
}
