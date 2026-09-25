import type { SubmitDefinitionAdapter, SubmitJson } from "./submit-adapter-contract.js";
import { checkSubmitAdapterProof } from "./submit-adapter-proof.js";
import { Boundary, add, applyEgress, clone, freeze, makeContext, unchanged } from "./submit-candidate-safety.js";
import type { CandidateEgress } from "./submit-candidate-safety.js";

type Result =
	| { readonly ok: true; readonly data: SubmitJson; readonly uiState: SubmitJson }
	| { readonly ok: false; readonly code: "unsafe_candidate" | "invalid_witness" };

/** Internal one-capture seam. Trusted callbacks are not a same-realm sandbox. */
export function prepareOwnedSubmitAdapter(
	state: { readonly data: unknown; readonly uiState: unknown },
	adapter: SubmitDefinitionAdapter,
	transforms: readonly CandidateEgress[] = [],
): Result {
	try {
		const dataDescriptor = Object.getOwnPropertyDescriptor(state, "data");
		const uiDescriptor = Object.getOwnPropertyDescriptor(state, "uiState");
		if (!dataDescriptor || !("value" in dataDescriptor) || !uiDescriptor || !("value" in uiDescriptor))
			throw new Error("state");
		const retained = new Boundary();
		const original = retained.copy(dataDescriptor.value);
		const ui = retained.copy(uiDescriptor.value);
		const capture = Object.freeze({ data: freeze(original), uiState: freeze(ui) });
		const blocked = new Set(retained.refs);
		blocked.add(state);
		add(blocked, clone(capture).refs);
		blocked.add(capture);
		const supplied = adapter(capture);
		if (!unchanged(capture, { data: original, uiState: ui })) throw new Error("mutation");
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
			unchanged(capture, { data: original, uiState: ui }) &&
			unchanged(supplied, snapshot) &&
			unchanged(context, contextSnapshot);
		if (!check()) throw new Error("mutation");
		const final = applyEgress(projection.value, context, transforms, blocked, check);
		if (!check()) throw new Error("mutation");
		const proof = checkSubmitAdapterProof(original, projection.value, () => witness.value, clone(final).value);
		if (!proof.ok) return proof;
		if (!check()) throw new Error("mutation");
		return { ok: true, data: proof.data, uiState: freeze(clone(ui).value) };
	} catch {
		return { ok: false, code: "unsafe_candidate" };
	}
}
