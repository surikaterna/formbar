import type { Segment } from "@formbar/expressions";
import type { ConcreteOwner } from "./runtime-ownership.js";

interface BindingNode {
	readonly children: Map<Segment, BindingNode>;
	readonly owners: Set<ConcreteOwner>;
	count: number;
}

function node(): BindingNode {
	return { children: new Map(), owners: new Set(), count: 0 };
}

/** Capture-local typed binding index; includes hidden and ineligible owners for fail-closed overlap checks. */
export function overlappingOwners(fields: readonly ConcreteOwner[]): ReadonlySet<ConcreteOwner> {
	const roots = new Map<string, BindingNode>();
	for (const owner of fields) {
		let current: BindingNode = roots.get(owner.binding.namespace) ?? node();
		roots.set(owner.binding.namespace, current);
		current.count++;
		for (const segment of owner.binding.segments) {
			let child: BindingNode | undefined = current.children.get(segment);
			if (!child) {
				child = node();
				current.children.set(segment, child);
			}
			current = child;
			current.count++;
		}
		current.owners.add(owner);
	}
	const overlaps = new Set<ConcreteOwner>();
	function visit(current: BindingNode, ancestor: boolean): void {
		if (ancestor || current.count > 1) for (const owner of current.owners) overlaps.add(owner);
		const inherited = ancestor || current.owners.size > 0;
		for (const child of current.children.values()) visit(child, inherited);
	}
	for (const root of roots.values()) visit(root, false);
	return overlaps;
}
