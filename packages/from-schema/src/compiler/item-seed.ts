import type { JsonValue } from "@formbar/declarative";
import type { DescriptorDocument, DescriptorNode } from "../descriptors/contracts.js";

export function itemSeed(document: DescriptorDocument, nodeId: string): JsonValue | undefined {
	return seed(document, nodeId, new Set());
}

function seed(document: DescriptorDocument, nodeId: string, visited: Set<string>): JsonValue | undefined {
	if (visited.has(nodeId)) return undefined;
	visited.add(nodeId);
	const evidence = document.evidence[nodeId];
	if (evidence?.default !== undefined && json(evidence.default)) return clone(evidence.default);
	if (evidence?.literal !== undefined && json(evidence.literal)) return clone(evidence.literal);
	if (evidence?.enum?.length && json(evidence.enum[0])) return clone(evidence.enum[0]);
	const node = document.nodes[nodeId];
	if (!node) return undefined;
	return neutral(document, node, visited);
}

function neutral(document: DescriptorDocument, node: DescriptorNode, visited: Set<string>): JsonValue | undefined {
	if (node.kind === "literal" && json(node.value)) return clone(node.value);
	if (node.kind === "enum" && node.values.length && json(node.values[0])) return clone(node.values[0]);
	if (node.kind === "object") return {};
	if (node.kind === "array") return [];
	if (node.kind === "primitive") {
		if (node.type === "string") return "";
		if (node.type === "boolean") return false;
		if (node.type === "number" || node.type === "integer") return 0;
	}
	if (node.kind === "wrapper") return seed(document, node.inner.nodeId, visited);
	if (node.kind === "ref" && node.target) return seed(document, node.target.nodeId, visited);
	return undefined;
}

function json(value: unknown): value is JsonValue {
	if (value === null || typeof value === "string" || typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(json);
	if (typeof value !== "object" || value === null) return false;
	return Object.values(value).every(json);
}

function clone<T extends JsonValue>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}
