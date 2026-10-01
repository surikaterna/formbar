import type { FormDefinition, FormNode, StateRef } from "@formbar/declarative";
import { type Node, schemaNode } from "../runtime/kalada-demo-schema";

function action(id: string, target: StateRef, name: string, label: string): FormNode {
	return {
		type: "action",
		id,
		target,
		action: name,
		label,
		...(name === "array.move"
			? {
					payload: {
						format: "kalada-program",
						version: 1,
						profile: "kalada-v1",
						expression: { kind: "literal", value: {} },
					},
				}
			: {}),
	};
}

/** Host-owned controls are not FSX syntax or source-defined capabilities. Destination admission checks them too. */
export function withArrayControls(definition: FormDefinition, schema: Node): FormDefinition {
	const ids = new Set<string>();
	const collect = (node: FormNode): void => {
		ids.add(node.id);
		if ("children" in node) node.children?.forEach(collect);
		if (node.type === "conditional") {
			node.then.forEach(collect);
			node.else?.forEach(collect);
		}
	};
	collect(definition.root);
	let sequence = 0;
	const nextId = () => {
		let id = `fsx-host-action-${++sequence}`;
		while (ids.has(id)) id = `fsx-host-action-${++sequence}`;
		ids.add(id);
		return id;
	};
	const visit = (node: FormNode): FormNode => {
		if (node.type === "conditional")
			// biome-ignore lint/suspicious/noThenProperty: FormDefinition uses a non-callable then branch, not a Promise.
			return { ...node, then: node.then.map(visit), ...(node.else ? { else: node.else.map(visit) } : {}) };
		if (!("children" in node)) return node;
		const children = node.children?.map(visit) ?? [];
		if (node.type !== "repeater") return { ...node, children };
		const installed = schemaNode(schema, node.binding.segments);
		return {
			...node,
			...(typeof installed?.maxItems === "number" ? { maxItems: installed.maxItems } : {}),
			...(typeof installed?.minItems === "number" ? { minItems: installed.minItems } : {}),
			children: [
				...children,
				action(nextId(), node.binding, "array.move", "Move row"),
				action(nextId(), node.binding, "array.remove", "Remove"),
			],
		};
	};
	return { ...definition, root: visit(definition.root) };
}
