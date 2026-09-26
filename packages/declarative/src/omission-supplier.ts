import type { FormApi, FormStateCapture, SubmitDataPath, SubmitJson, SubmitStructuralWitness } from "@formbar/core";
import {
	checkSubmitAdapterProof,
	clone,
	freeze,
	registerBoundSubmitSupplier,
} from "@formbar/core/internal/submit-proof";
import type { ValidatedFormDefinition } from "./definition.js";
import { type ExclusiveBindingDecision, decideExclusiveBindings } from "./exclusive-binding-decision.js";
import { anchors, overlaps, pathId, remove, typedPath, valueAt } from "./omission-structure.js";
import { type ConcreteOwnership, projectConcreteOwnership } from "./runtime-ownership.js";

const definitions = new WeakMap<FormApi<unknown, unknown>, ValidatedFormDefinition>();

/** Only a prepared definition/form pair can supply this private, non-activating projection. */
export function bindOmissionSupplier(form: FormApi<unknown, unknown>, definition: ValidatedFormDefinition): void {
	const existing = definitions.get(form);
	if (existing && existing !== definition) throw Error("conflicting definition");
	if (existing) return;
	registerBoundSubmitSupplier(form, (capture, signal) => {
		const parts = projectBoundOmissionParts(form, definition, capture, signal);
		return parts?.current() ? { data: parts.data, witness: parts.witness } : undefined;
	});
	definitions.set(form, definition);
}

interface Projection {
	readonly data: SubmitJson;
	readonly witness: SubmitStructuralWitness;
	readonly checkFinal: (final: unknown) => boolean;
}

const detachPath = (path: SubmitDataPath): SubmitDataPath => path.map((segment) => ({ ...segment }));

function detachWitness(witness: SubmitStructuralWitness): SubmitStructuralWitness {
	return {
		kind: witness.kind,
		omitted: witness.omitted.map(detachPath),
		protected: witness.protected.map((entry) => ({ path: detachPath(entry.path), value: clone(entry.value).value })),
		rowAnchors: witness.rowAnchors.map((entry) => ({ array: detachPath(entry.array), key: detachPath(entry.key) })),
	};
}

function distinct(paths: readonly SubmitDataPath[]): SubmitDataPath[] {
	const byId = new Map(paths.map((path) => [pathId(path), path]));
	return [...byId.values()];
}

function protectedPaths(
	data: SubmitJson,
	paths: readonly SubmitDataPath[],
	omitted: readonly SubmitDataPath[],
): SubmitStructuralWitness["protected"] {
	const result: { path: SubmitDataPath; value: SubmitJson }[] = [];
	for (const path of distinct(paths).sort((a, b) => a.length - b.length)) {
		const value = valueAt(data, path);
		if (value === undefined) continue;
		if (omitted.some((other) => overlaps(other, path))) throw Error("protected overlap");
		if (result.some((entry) => overlaps(entry.path, path))) continue;
		result.push({ path, value: clone(value).value });
	}
	return result;
}

function projectParts(original: SubmitJson, ownership: ConcreteOwnership, decision: ExclusiveBindingDecision) {
	const data = clone(original).value;
	const fields = decision.fields.map((entry) => ({ path: typedPath(entry.owner.binding), decision: entry.decision }));
	const repeaters = decision.repeaters.map((entry) => ({
		path: typedPath(entry.owner.binding),
		decision: entry.decision,
	}));
	const unknown = ownership.unknown.filter((item) => item.namespace === "data").map(typedPath);
	const omitted = [
		...fields.filter((entry) => entry.decision === "exclusive").map((entry) => entry.path),
		...repeaters
			.filter(
				(entry) =>
					entry.decision === "exclusive" &&
					Array.isArray(valueAt(original, entry.path)) &&
					(valueAt(original, entry.path) as readonly SubmitJson[]).length === 0,
			)
			.map((entry) => entry.path),
	];
	if (omitted.some((path, i) => omitted.some((other, j) => i !== j && overlaps(path, other)))) throw Error("overlap");
	// Repeater bindings are structural, not protected values; their child cells remain independently editable.
	const protectedFields = fields.filter((entry) => entry.decision !== "exclusive").map((entry) => entry.path);
	if (unknown.some((path) => omitted.some((other) => overlaps(path, other)))) throw Error("unknown");
	const protectedValues = protectedPaths(original, protectedFields, omitted);
	for (const path of omitted) remove(data, path);
	const witness: SubmitStructuralWitness = {
		kind: omitted.length ? "omission" : "no-omission",
		omitted,
		protected: protectedValues,
		rowAnchors: anchors(original, data, omitted),
	};
	return { data, witness };
}

/** One externally supplied capture; no recapture, renderer pass, adapter assertion or draft mutation. */
function projectBoundOmissionParts(
	form: FormApi<unknown, unknown>,
	definition: ValidatedFormDefinition,
	capture: FormStateCapture<unknown, unknown>,
	signal?: AbortSignal,
): { data: SubmitJson; witness: SubmitStructuralWitness; current: () => boolean } | undefined {
	if (signal?.aborted) return undefined;
	try {
		const ownership = projectConcreteOwnership({ form, definition, capture });
		const decision = decideExclusiveBindings(ownership, signal);
		if (!decision.current() || ownership.diagnostics) return undefined;
		const original = clone(capture.state.data).value;
		const { data, witness } = projectParts(original, ownership, decision);
		if (!decision.current()) return undefined;
		const plan = freeze(clone(detachWitness(witness)).value) as unknown as SubmitStructuralWitness;
		const projected = freeze(data);
		return decision.current() && !signal?.aborted
			? Object.freeze({ data: projected, witness: plan, current: decision.current })
			: undefined;
	} catch {
		return undefined;
	}
}

/** Legacy projection helper retains its independent proof; guarded mode uses parts only. */
export function projectBoundOmission(
	form: FormApi<unknown, unknown>,
	capture: FormStateCapture<unknown, unknown>,
	signal?: AbortSignal,
): Projection | undefined {
	const definition = definitions.get(form);
	if (!definition) return undefined;
	const parts = projectBoundOmissionParts(form, definition, capture, signal);
	if (!parts) return undefined;
	const before = freeze(clone(capture.state.data).value);
	if (!checkSubmitAdapterProof(before, parts.data, () => parts.witness, clone(parts.data).value).ok) return undefined;
	return Object.freeze({
		data: parts.data,
		witness: parts.witness,
		checkFinal: (final: unknown) =>
			!signal?.aborted && parts.current() && checkSubmitAdapterProof(before, parts.data, () => parts.witness, final).ok,
	});
}
