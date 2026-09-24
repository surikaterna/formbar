import type {
	DescriptorDocument,
	DescriptorNode,
	DescriptorOccurrence,
	DescriptorValue,
} from "../descriptors/contracts.js";

// Scheman's direct JSON Schema type+enum pair has two bare operands. Branch schemas
// carry their own metadata, so they must not be interpreted as direct choices.
export function directTypedEnum(
	document: DescriptorDocument,
	occurrence: DescriptorOccurrence,
	node: DescriptorNode,
): boolean {
	if (document.source.provider !== "json-schema" || node.kind !== "intersection" || node.operands.length !== 2)
		return false;
	if (node.applicators && Object.values(node.applicators).some((value) => value && Object.keys(value).length))
		return false;
	const operands = occurrence.children.map((id) => document.occurrences[id]);
	if (operands.length !== 2 || operands.some((child, index) => !bareOperand(child, node.operands[index].nodeId, index)))
		return false;
	const primitive = document.nodes[operands[0].nodeId];
	const enumeration = document.nodes[operands[1].nodeId];
	if (
		!bareNode(primitive) ||
		!bareNode(enumeration) ||
		primitive.kind !== "primitive" ||
		enumeration.kind !== "enum" ||
		enumeration.values.length === 0
	)
		return false;
	const type = primitive.type;
	if (type !== "string" && type !== "number" && type !== "integer" && type !== "boolean") return false;
	const values = enumeration.values;
	return new Set(values).size === values.length && values.every((value) => compatible(value, type));
}

function bareOperand(child: DescriptorOccurrence | undefined, nodeId: string, index: number): boolean {
	return (
		!!child &&
		child.relation === "operand" &&
		child.key === index &&
		child.expansion === "expanded" &&
		child.children.length === 0 &&
		child.nodeId === nodeId
	);
}

function bareNode(node: DescriptorNode | undefined): node is DescriptorNode {
	return !!node && node.metadata === undefined && node.constraints === undefined && node.applicators === undefined;
}

function compatible(value: DescriptorValue, type: "string" | "number" | "integer" | "boolean"): boolean {
	if (type === "string") return typeof value === "string";
	if (type === "boolean") return typeof value === "boolean";
	if (typeof value !== "number" || !Number.isFinite(value)) return false;
	return type === "number" || Number.isSafeInteger(value);
}
