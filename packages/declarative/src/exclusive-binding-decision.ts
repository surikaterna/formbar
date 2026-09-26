import type { AbsoluteBinding } from "./bindings.js";
import { OwnershipOverlapIndex } from "./ownership-overlap-index.js";
import { isProjectedOwnership } from "./runtime-ownership.js";
import type { ConcreteOwner, ConcreteOwnership } from "./runtime-ownership.js";

export type BindingDecision = "exclusive" | "protected" | "unknown";

export interface ConcreteBindingDecision {
	readonly owner: ConcreteOwner;
	readonly decision: BindingDecision;
}

export interface ExclusiveBindingDecision {
	readonly fields: readonly ConcreteBindingDecision[];
	readonly repeaters: readonly ConcreteBindingDecision[];
	readonly current: () => boolean;
	readonly forField: (fieldId: string, instanceKey: string) => ConcreteBindingDecision | undefined;
}

function index(bindings: readonly AbsoluteBinding[]): OwnershipOverlapIndex {
	const result = new OwnershipOverlapIndex();
	for (const binding of bindings) result.add(binding);
	return result;
}

/** A repeater is structural: its visibility never protects a hidden child cell. */
function classify(
	owner: ConcreteOwner,
	ownership: ConcreteOwnership,
	active: OwnershipOverlapIndex,
	unknown: OwnershipOverlapIndex,
): BindingDecision {
	if (ownership.diagnostics) return "unknown";
	if (owner.visible || owner.submitWhenHidden === "include") return "protected";
	if (owner.binding.namespace !== "data" || owner.binding.segments.length === 0) return "unknown";
	if (typeof owner.binding.segments.at(-1) === "number") return "unknown";
	if (unknown.query(owner.binding).overlaps > 0) return "unknown";
	if (active.query(owner.binding).overlaps > 0 || owner.protected) return "protected";
	if (!owner.eligible) return "unknown";
	return "exclusive";
}

/** Private read-only decision on an already projected, single-capture ownership model. No payload is built. */
export function decideExclusiveBindings(ownership: ConcreteOwnership, signal?: AbortSignal): ExclusiveBindingDecision {
	if (!isProjectedOwnership(ownership)) throw new Error("UNVERIFIED_CONCRETE_OWNERSHIP");
	const current = () => !signal?.aborted && ownership.current() && ownership.capturedCurrent();
	const active = index(
		ownership.fields
			.filter((field) => field.visible || field.submitWhenHidden === "include")
			.map((field) => field.binding),
	);
	const unknown = index([
		...ownership.unknown,
		...ownership.fields.filter((field) => !field.eligible && !field.protected).map((field) => field.binding),
		...ownership.repeaters.filter((item) => !item.eligible && !item.protected).map((item) => item.binding),
	]);
	const decide = (owner: ConcreteOwner): ConcreteBindingDecision => {
		const classification =
			ownership.hiddenValues === "omit-inactive" ? classify(owner, ownership, active, unknown) : "unknown";
		return Object.freeze({
			owner,
			get decision(): BindingDecision {
				return current() ? classification : "unknown";
			},
		});
	};
	const fields = Object.freeze(ownership.fields.map(decide));
	const repeaters = Object.freeze(ownership.repeaters.map(decide));
	return Object.freeze({
		fields,
		repeaters,
		current,
		forField: (fieldId: string, instanceKey: string) => {
			if (!current() || ownership.forField(fieldId) === undefined) return undefined;
			const record = fields.find(
				(entry) => entry.owner.instance.nodeId === fieldId && entry.owner.instance.instanceKey === instanceKey,
			);
			return record;
		},
	});
}
