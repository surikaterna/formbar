import type { KaladaV1Snapshot } from "@formbar/declarative";

type Node = KaladaV1Snapshot["tree"];
export type RepeaterAssociation = { readonly scope: string; readonly row?: string };
type Ancestor = { readonly node: Node; readonly row: string };

function visitList(nodes: readonly Node[], ancestors: readonly Ancestor[], result: Map<string, RepeaterAssociation>) {
	const first = new Map<string, Node>();
	for (const node of nodes)
		if (node.type === "repeater" && node.arrayTarget && !first.has(node.arrayTarget)) first.set(node.arrayTarget, node);
	const preceding = new Map<string, Node>();
	for (const node of nodes) {
		if (node.type === "repeater" && node.arrayTarget) preceding.set(node.arrayTarget, node);
		if (node.action && node.arrayTarget) {
			const ancestor = [...ancestors].reverse().find((entry) => entry.node.arrayTarget === node.arrayTarget);
			const sibling = preceding.get(node.arrayTarget) ?? first.get(node.arrayTarget);
			if (ancestor) result.set(node.key, { scope: ancestor.node.key, row: ancestor.row });
			else if (sibling) result.set(node.key, { scope: sibling.key });
		}
		visitList(node.children ?? [], ancestors, result);
		for (const item of node.items ?? []) visitList(item.children, ancestors, result);
		for (const row of node.rows ?? []) visitList(row.children, [...ancestors, { node, row: row.key }], result);
	}
}

/** Concrete lexical ancestry wins; otherwise the nearest preceding same-target sibling owns the presentation. */
export function associateRepeaters(tree: Node) {
	const result = new Map<string, RepeaterAssociation>();
	visitList([tree], [], result);
	return result;
}
