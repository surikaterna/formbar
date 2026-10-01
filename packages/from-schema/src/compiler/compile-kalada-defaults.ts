import type { JsonValue, SchemaDefaultV1 } from "@formbar/declarative";
import { copyJson } from "@formbar/expressions";
import type { DescriptorDocument, DescriptorNode } from "../descriptors/contracts.js";

function accepts(document: DescriptorDocument, node: DescriptorNode, value: JsonValue, depth = 0): boolean {
	if (depth > 64) return false;
	if (node.kind === "primitive") {
		if (node.type === "integer") return typeof value === "number" && Number.isInteger(value);
		if (node.type === "number") return typeof value === "number";
		if (node.type === "date") return typeof value === "string";
		return (
			(node.type === "string" && typeof value === "string") ||
			(node.type === "boolean" && typeof value === "boolean") ||
			(node.type === "null" && value === null)
		);
	}
	if (node.kind === "literal") return JSON.stringify(value) === JSON.stringify(node.value);
	if (node.kind === "enum") return node.values.some((item) => JSON.stringify(item) === JSON.stringify(value));
	if (node.kind === "wrapper" && !["catch", "effect", "pipeline", "coerce"].includes(node.wrapper)) {
		const inner = document.nodes[node.inner.nodeId];
		return (node.wrapper === "nullable" && value === null) || (!!inner && accepts(document, inner, value, depth + 1));
	}
	if (node.kind === "intersection")
		return node.operands.every((ref) => {
			const operand = document.nodes[ref.nodeId];
			return !!operand && accepts(document, operand, value, depth + 1);
		});
	if (node.kind === "array" && Array.isArray(value)) {
		const item = document.nodes[node.items.nodeId];
		return !!item && value.every((entry) => accepts(document, item, entry, depth + 1));
	}
	if (node.kind === "object" && value && typeof value === "object" && !Array.isArray(value)) {
		const record = value as Record<string, JsonValue>;
		return Object.keys(record).every((key) => {
			const property = node.properties.find((entry) => entry.name === key);
			const child = property && document.nodes[property.node.nodeId];
			return !!child && accepts(document, child, record[key] as JsonValue, depth + 1);
		});
	}
	return false;
}

/** Paths are schema locations; '*' is resolved only by the host against owned row identities. */
export function compileKaladaDefaults(document: DescriptorDocument): readonly SchemaDefaultV1[] {
	const result: SchemaDefaultV1[] = [];
	const visit = (id: string, path: readonly (string | "*")[], depth: number): void => {
		if (depth > 64) throw new TypeError("Schema default nesting limit exceeded.");
		const occurrence = document.occurrences[id];
		if (!occurrence || occurrence.expansion !== "expanded")
			throw new TypeError("Incomplete schema default projection.");
		const node = document.nodes[occurrence.nodeId];
		if (!node) throw new TypeError("Missing schema default descriptor.");
		const evidence = document.evidence[occurrence.nodeId]?.default;
		const value =
			evidence !== undefined
				? evidence
				: node.kind === "wrapper" && node.wrapper === "default"
					? node.value
					: undefined;
		if (value !== undefined) {
			const normalized = copyJson(value);
			if (!accepts(document, node, normalized))
				throw new TypeError(`Invalid schema default at ${JSON.stringify(path)}.`);
			result.push(Object.freeze({ path: Object.freeze([...path]), value: normalized }));
		}
		for (const childId of occurrence.children) {
			const child = document.occurrences[childId];
			if (!child) throw new TypeError("Missing schema default occurrence.");
			const segment = child.relation === "property" ? child.key : child.relation === "items" ? "*" : undefined;
			visit(childId, typeof segment === "string" ? [...path, segment] : path, depth + 1);
		}
	};
	visit(document.rootOccurrenceId, [], 0);
	return Object.freeze(result);
}
