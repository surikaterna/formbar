import type { Segment } from "@formbar/expressions";
import type { AbsoluteBinding } from "./bindings.js";

interface Node {
	count: number;
	exact: number;
	children: Map<Segment, Node>;
}

function node(): Node {
	return { count: 0, exact: 0, children: new Map() };
}

/** Counts typed ancestor, exact and descendant bindings without enumerating overlap pairs. */
export class OwnershipOverlapIndex {
	private readonly roots = new Map<string, Node>();

	add(binding: AbsoluteBinding): void {
		let root = this.roots.get(binding.namespace);
		if (!root) {
			root = node();
			this.roots.set(binding.namespace, root);
		}
		let current: Node = root;
		current.count++;
		for (const segment of binding.segments) {
			let child = current.children.get(segment);
			if (!child) {
				child = node();
				current.children.set(segment, child);
			}
			current = child;
			current.count++;
		}
		current.exact++;
	}

	query(binding: AbsoluteBinding): { exact: number; descendants: number; overlaps: number } {
		let current = this.roots.get(binding.namespace);
		if (!current) return { exact: 0, descendants: 0, overlaps: 0 };
		let ancestors = 0;
		for (const segment of binding.segments) {
			ancestors += current.exact;
			current = current.children.get(segment);
			if (!current) return { exact: 0, descendants: 0, overlaps: ancestors };
		}
		const exact = current.exact;
		return { exact, descendants: current.count - exact, overlaps: ancestors + current.count };
	}
}
