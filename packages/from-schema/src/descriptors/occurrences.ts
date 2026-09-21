import type { ProjectionDiagnostic } from "../diagnostics.js";
import { sortProjectionDiagnostics } from "../diagnostics.js";
import type { DescriptorNode, DescriptorOccurrence, OccurrencePathSegment, OccurrenceRelation } from "./contracts.js";
import type { ProjectionLimits } from "./limits.js";

interface Edge {
	readonly nodeId: string;
	readonly relation: OccurrenceRelation;
	readonly key?: string | number;
	readonly presence?: "required" | "optional" | "unknown";
}

interface MutableOccurrence {
	id: string;
	nodeId: string;
	path: readonly OccurrencePathSegment[];
	relation: OccurrenceRelation;
	key?: string | number;
	presence?: "required" | "optional" | "unknown";
	expansion: "expanded" | "cycle" | "limit" | "missing";
	shared: boolean;
	children: string[];
}

export interface OccurrenceProjection {
	readonly rootOccurrenceId: string;
	readonly occurrences: Readonly<Record<string, DescriptorOccurrence>>;
	readonly definitionOccurrenceIds: readonly string[];
	readonly diagnostics: readonly ProjectionDiagnostic[];
}

export function projectOccurrences(
	nodes: Readonly<Record<string, DescriptorNode>>,
	rootNodeId: string,
	definitionNodeIds: readonly string[],
	limits: ProjectionLimits,
): OccurrenceProjection {
	const state = createState(nodes, limits);
	const root = expand(state, rootNodeId, [], "root", undefined, undefined, [], 0);
	const definitionOccurrenceIds = definitionNodeIds.map((nodeId, index) => {
		if (index >= limits.maxDefinitionExpansions) {
			return createLimitOccurrence(
				state,
				nodeId,
				[],
				"root",
				index,
				undefined,
				"definition-limit",
				"Definition occurrence expansion limit reached.",
			);
		}
		return expand(state, nodeId, [], "root", index, undefined, [], 0);
	});
	return Object.freeze({
		rootOccurrenceId: root ?? "occ-missing-root",
		occurrences: freezeOccurrences(state.occurrences),
		definitionOccurrenceIds: Object.freeze(definitionOccurrenceIds),
		diagnostics: sortProjectionDiagnostics(state.diagnostics),
	});
}

interface ProjectionState {
	readonly nodes: Readonly<Record<string, DescriptorNode>>;
	readonly limits: ProjectionLimits;
	readonly occurrences: Record<string, MutableOccurrence>;
	readonly seen: Map<string, number>;
	readonly diagnostics: ProjectionDiagnostic[];
	nextId: number;
	expanded: number;
}

function createState(nodes: Readonly<Record<string, DescriptorNode>>, limits: ProjectionLimits): ProjectionState {
	return { nodes, limits, occurrences: {}, seen: new Map(), diagnostics: [], nextId: 0, expanded: 0 };
}

function expand(
	state: ProjectionState,
	nodeId: string,
	path: readonly OccurrencePathSegment[],
	relation: OccurrenceRelation,
	key: string | number | undefined,
	presence: "required" | "optional" | "unknown" | undefined,
	ancestors: readonly string[],
	depth: number,
): string {
	if (state.expanded >= state.limits.maxOccurrences)
		return createLimitOccurrence(
			state,
			nodeId,
			path,
			relation,
			key,
			presence,
			"occurrence-limit",
			"Occurrence expansion limit reached.",
		);
	const occurrence = createOccurrence(state, nodeId, path, relation, key, presence);
	state.expanded += 1;
	const node = state.nodes[nodeId];
	if (!node) return stop(state, occurrence, "missing", "missing-node", "Descriptor node is missing.");
	if (ancestors.includes(nodeId))
		return stop(state, occurrence, "cycle", "occurrence-cycle", "Cycle retained without recursive expansion.");
	if (depth >= state.limits.maxOccurrenceDepth)
		return stop(state, occurrence, "limit", "occurrence-limit", "Occurrence depth limit reached.");
	for (const edge of childEdges(node)) {
		const childPath = edgePath(path, edge);
		const child = expand(
			state,
			edge.nodeId,
			childPath,
			edge.relation,
			edge.key,
			edge.presence,
			[...ancestors, nodeId],
			depth + 1,
		);
		if (child) occurrence.children.push(child);
	}
	return occurrence.id;
}

function createOccurrence(
	state: ProjectionState,
	nodeId: string,
	path: readonly OccurrencePathSegment[],
	relation: OccurrenceRelation,
	key: string | number | undefined,
	presence: "required" | "optional" | "unknown" | undefined,
): MutableOccurrence {
	const count = state.seen.get(nodeId) ?? 0;
	state.seen.set(nodeId, count + 1);
	const occurrence: MutableOccurrence = {
		id: `occ-${String(state.nextId++).padStart(6, "0")}`,
		nodeId,
		path: Object.freeze([...path]),
		relation,
		...(key === undefined ? {} : { key }),
		...(presence === undefined ? {} : { presence }),
		expansion: "expanded",
		shared: count > 0,
		children: [],
	};
	state.occurrences[occurrence.id] = occurrence;
	return occurrence;
}

function createLimitOccurrence(
	state: ProjectionState,
	nodeId: string,
	path: readonly OccurrencePathSegment[],
	relation: OccurrenceRelation,
	key: string | number | undefined,
	presence: "required" | "optional" | "unknown" | undefined,
	code: "occurrence-limit" | "definition-limit",
	message: string,
): string {
	const occurrence = createOccurrence(state, nodeId, path, relation, key, presence);
	return stop(state, occurrence, "limit", code, message);
}

function stop(
	state: ProjectionState,
	occurrence: MutableOccurrence,
	expansion: MutableOccurrence["expansion"],
	code: ProjectionDiagnostic["code"],
	message: string,
): string {
	occurrence.expansion = expansion;
	state.diagnostics.push({ ...diagnostic(code, occurrence.nodeId, message), occurrenceId: occurrence.id });
	return occurrence.id;
}

function childEdges(node: DescriptorNode): readonly Edge[] {
	const edges: Edge[] = structuralEdges(node);
	const applicators = node.applicators;
	if (!applicators) return edges;
	for (const key of ["if", "then", "else", "not", "contains", "propertyNames"] as const) {
		const target = applicators[key];
		if (target) edges.push({ nodeId: target.nodeId, relation: "applicator", key });
	}
	for (const [key, target] of sortedEntries(applicators.patternProperties))
		edges.push({ nodeId: target.nodeId, relation: "applicator", key: `pattern:${key}` });
	for (const [key, target] of sortedEntries(applicators.dependentSchemas))
		edges.push({ nodeId: target.nodeId, relation: "applicator", key: `dependent:${key}` });
	return edges;
}

function structuralEdges(node: DescriptorNode): Edge[] {
	if (node.kind === "object") {
		const edges: Edge[] = node.properties.map((property) => ({
			nodeId: property.node.nodeId,
			relation: "property",
			key: property.name,
			presence: property.presence,
		}));
		if (node.additionalProperties)
			edges.push({ nodeId: node.additionalProperties.nodeId, relation: "additional-properties" });
		return edges;
	}
	if (node.kind === "array") return [{ nodeId: node.items.nodeId, relation: "items" }];
	if (node.kind === "tuple")
		return [
			...node.items.map((item, index): Edge => ({ nodeId: item.nodeId, relation: "tuple-item", key: index })),
			...(node.rest ? [{ nodeId: node.rest.nodeId, relation: "tuple-rest" } as Edge] : []),
		];
	if (node.kind === "record")
		return [
			{ nodeId: node.key.nodeId, relation: "record-key" },
			{ nodeId: node.value.nodeId, relation: "record-value" },
		];
	if (node.kind === "union")
		return node.alternatives.map((item, index) => ({ nodeId: item.nodeId, relation: "alternative", key: index }));
	if (node.kind === "intersection")
		return node.operands.map((item, index) => ({ nodeId: item.nodeId, relation: "operand", key: index }));
	if (node.kind === "ref" && node.target) return [{ nodeId: node.target.nodeId, relation: "reference" }];
	if (node.kind === "wrapper") return [{ nodeId: node.inner.nodeId, relation: "wrapper" }];
	return [];
}

function edgePath(path: readonly OccurrencePathSegment[], edge: Edge): readonly OccurrencePathSegment[] {
	if (edge.relation === "property" && typeof edge.key === "string") return [...path, edge.key];
	if (edge.relation === "items" || edge.relation === "tuple-rest") return [...path, "*"];
	if (edge.relation === "tuple-item" && typeof edge.key === "number") return [...path, edge.key];
	return path;
}

function sortedEntries(values: Readonly<Record<string, { readonly nodeId: string }>> | undefined) {
	return Object.entries(values ?? {}).sort(([left], [right]) => left.localeCompare(right));
}

function diagnostic(code: ProjectionDiagnostic["code"], nodeId: string, message: string): ProjectionDiagnostic {
	return { code, severity: code === "missing-node" ? "error" : "warning", nodeId, message };
}

function freezeOccurrences(values: Record<string, MutableOccurrence>): Readonly<Record<string, DescriptorOccurrence>> {
	return Object.freeze(
		Object.fromEntries(
			Object.entries(values).map(([id, value]) => [
				id,
				Object.freeze({ ...value, children: Object.freeze(value.children) }),
			]),
		),
	);
}
