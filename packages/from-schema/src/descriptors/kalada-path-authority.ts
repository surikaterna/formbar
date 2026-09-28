import type { DescriptorDocument, DescriptorNode } from "./contracts.js";

type Part = string | number | { readonly row: string };
export interface ProjectedPathAuthority {
	readonly availability: "complete" | "partial" | "unavailable";
	readonly paths: readonly { readonly path: readonly Part[]; readonly kind: "array" | "value" }[];
}

function hasApplicators(node: DescriptorNode): boolean {
	const source = node.applicators;
	return (
		!!source &&
		Object.values(source).some((entry) => entry && (typeof entry !== "object" || Object.keys(entry).length > 0))
	);
}

function closedObjectChildren(
	document: DescriptorDocument,
	node: Extract<DescriptorNode, { kind: "object" }>,
	children: readonly string[],
): readonly { id: string; key: string }[] {
	if (
		node.unknownKeys !== "reject" ||
		(node.additionalProperties && document.nodes[node.additionalProperties.nodeId]?.kind !== "never")
	)
		throw new TypeError("Open object path");
	const properties = new Map(node.properties.map((property) => [property.name, property.node.nodeId]));
	if (properties.size !== node.properties.length) throw new TypeError("Ambiguous object path");
	const found = new Set<string>();
	const allowed: { id: string; key: string }[] = [];
	for (const child of children) {
		const entry = document.occurrences[child];
		if (
			entry?.relation === "additional-properties" &&
			entry.nodeId === node.additionalProperties?.nodeId &&
			document.nodes[entry.nodeId]?.kind === "never"
		)
			continue;
		if (
			!entry ||
			entry.relation !== "property" ||
			typeof entry.key !== "string" ||
			!properties.has(entry.key) ||
			properties.get(entry.key) !== entry.nodeId ||
			found.has(entry.key)
		)
			throw new TypeError("Ambiguous object path");
		found.add(entry.key);
		allowed.push({ id: child, key: entry.key });
	}
	if (found.size !== properties.size) throw new TypeError("Incomplete object path");
	return allowed;
}

/** Host adapter: consume actual projected input evidence, never infer an open-ended data namespace. */
export function attestProjectedInputPaths(
	document: DescriptorDocument,
	rows: ReadonlyMap<string, string> = new Map(),
): ProjectedPathAuthority {
	if (
		document.source.side !== "input" ||
		document.source.availability !== "complete" ||
		document.sourceDiagnostics.length ||
		document.projectionDiagnostics.length
	)
		throw new TypeError("Incomplete projected input authority");
	const paths: { path: readonly Part[]; kind: "array" | "value" }[] = [];
	const visited = new Set<string>();
	const visit = (id: string, path: readonly Part[], depth: number): void => {
		if (depth > 64 || paths.length > 4096) throw new TypeError("Projection path limit");
		const occurrence = document.occurrences[id];
		if (!occurrence || occurrence.expansion !== "expanded" || visited.has(id))
			throw new TypeError("Incomplete or cyclic projection path");
		visited.add(id);
		const node = document.nodes[occurrence.nodeId];
		if (
			!node ||
			node.kind === "opaque" ||
			node.kind === "unknown" ||
			node.kind === "unconstrained" ||
			node.kind === "never" ||
			hasApplicators(node)
		)
			throw new TypeError("Ambiguous projected node");
		if (node.kind === "array") {
			const row = rows.get(JSON.stringify(path));
			if (row === undefined) throw new TypeError("Array lacks lexical row authority");
			if (
				occurrence.children.length !== 1 ||
				occurrence.children.some(
					(child) =>
						document.occurrences[child]?.relation !== "items" ||
						document.occurrences[child]?.nodeId !== node.items.nodeId,
				)
			)
				throw new TypeError("Ambiguous array path");
			for (const child of occurrence.children) visit(child, [...path, { row }], depth + 1);
			paths.push({ path, kind: "array" });
		} else if (node.kind === "object") {
			for (const child of closedObjectChildren(document, node, occurrence.children))
				visit(child.id, [...path, child.key], depth + 1);
			paths.push({ path, kind: "value" });
		} else if (node.kind === "primitive" || node.kind === "literal" || node.kind === "enum") {
			if (occurrence.children.length) throw new TypeError("Ambiguous scalar path");
			paths.push({ path, kind: "value" });
		} else {
			throw new TypeError(`Unsupported projected path node: ${(node as DescriptorNode).kind}`);
		}
	};
	visit(document.rootOccurrenceId, [], 0);
	return { availability: "complete", paths };
}
