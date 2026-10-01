import type { KaladaV1Snapshot } from "@formbar/declarative";
type Node = KaladaV1Snapshot["tree"];
export const validationId = (prefix: string, key: string) => `${prefix}-${encodeURIComponent(key)}-validation`;

export function validationDescriptions(tree: Node, prefix: string) {
	const result = new Map<string, string[]>();
	const visit = (node: Node) => {
		if (node.type === "validation" && node.validationFor && node.issues?.length)
			result.set(node.validationFor, [...(result.get(node.validationFor) ?? []), validationId(prefix, node.key)]);
		for (const child of node.children ?? []) visit(child);
		for (const item of node.items ?? []) for (const child of item.children) visit(child);
		for (const row of node.rows ?? []) for (const child of row.children) visit(child);
	};
	visit(tree);
	return result;
}

/** Authored feedback is associated presentation only; original field/schema issues stay untouched. */
export function KaladaValidationFeedback({ node, prefix }: { node: Node; prefix: string }) {
	return (
		<div id={validationId(prefix, node.key)} data-kalada-validation={node.nodeId} aria-live="polite">
			<ul>
				{node.issues?.map((message, i) => (
					<li key={`${i}:${message}`}>{message}</li>
				))}
			</ul>
		</div>
	);
}
