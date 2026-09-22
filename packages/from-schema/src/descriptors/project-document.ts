import type { SchemaDocument } from "@scheman/core";
import type { ProjectionDiagnostic, SourceDiagnostic } from "../diagnostics.js";
import { sortProjectionDiagnostics } from "../diagnostics.js";
import type {
	DescriptorDefinition,
	DescriptorDocument,
	DescriptorNode,
	DescriptorSide,
	DescriptorValue,
} from "./contracts.js";
import { normalizedEvidence } from "./evidence.js";
import { type ProjectionLimitOptions, resolveProjectionLimits } from "./limits.js";
import { projectOccurrences } from "./occurrences.js";
import { projectNode } from "./project-node.js";

export interface ProjectDocumentOptions {
	readonly providerName: string;
	readonly side: DescriptorSide;
	readonly limits?: ProjectionLimitOptions;
}

export function projectSchemaDocument(document: SchemaDocument, options: ProjectDocumentOptions): DescriptorDocument {
	const definitions = document.definitions.filter((definition) => definition.side === options.side);
	const rootNodeId = document.root[options.side].nodeId;
	const nodeIds = reachableNodeIds(document, [rootNodeId, ...definitions.map((item) => item.node.nodeId)]);
	const nodes = projectNodes(document, nodeIds);
	const evidence = projectEvidence(nodes);
	const occurrenceProjection = projectOccurrences(
		nodes,
		rootNodeId,
		definitions.map((item) => item.node.nodeId),
		resolveProjectionLimits(options.limits),
	);
	const projectedDefinitions = projectDefinitions(definitions, occurrenceProjection.definitionOccurrenceIds);
	return Object.freeze({
		formatVersion: 1,
		source: Object.freeze({
			provider: options.providerName,
			side: options.side,
			availability: document.capabilities[options.side],
			capabilities: Object.freeze({ ...document.capabilities }),
			metadata: document.metadata as DescriptorValue,
		}),
		rootOccurrenceId: occurrenceProjection.rootOccurrenceId,
		nodes,
		occurrences: occurrenceProjection.occurrences,
		definitions: projectedDefinitions,
		evidence,
		sourceDiagnostics: sourceDiagnostics(document),
		projectionDiagnostics: occurrenceProjection.diagnostics,
	});
}

function projectEvidence(nodes: Readonly<Record<string, DescriptorNode>>) {
	return Object.freeze(
		Object.fromEntries(
			Object.entries(nodes).map(([id, node]) => {
				const own = normalizedEvidence(node);
				if (node.kind !== "array") return [id, own];
				const values = enumValues(node.items.nodeId, nodes, new Set());
				if (values) return [id, Object.freeze({ ...own, enum: values })];
				return [id, own];
			}),
		),
	);
}

function enumValues(
	id: string,
	nodes: Readonly<Record<string, DescriptorNode>>,
	seen: Set<string>,
): readonly DescriptorValue[] | undefined {
	if (seen.has(id)) return undefined;
	seen.add(id);
	const node = nodes[id];
	if (!node) return undefined;
	if (node.kind === "enum") return node.values;
	if (node.kind === "literal") return Object.freeze([node.value]);
	if (node.kind === "wrapper") return enumValues(node.inner.nodeId, nodes, seen);
	if (node.kind === "ref" && node.target) return enumValues(node.target.nodeId, nodes, seen);
	if (node.kind !== "intersection") return undefined;
	const candidates = node.operands
		.map((operand) => enumValues(operand.nodeId, nodes, seen))
		.filter((values): values is readonly DescriptorValue[] => values !== undefined);
	return candidates.length === 1 ? candidates[0] : undefined;
}

function projectNodes(
	document: SchemaDocument,
	nodeIds: ReadonlySet<string>,
): Readonly<Record<string, DescriptorNode>> {
	const entries = [...nodeIds]
		.sort((left, right) => left.localeCompare(right))
		.flatMap((nodeId): readonly [string, DescriptorNode][] => {
			const node = document.nodes[nodeId];
			return node ? [[nodeId, projectNode(node)]] : [];
		});
	return Object.freeze(Object.fromEntries(entries));
}

function projectDefinitions(
	definitions: SchemaDocument["definitions"],
	occurrenceIds: readonly (string | undefined)[],
): readonly DescriptorDefinition[] {
	return Object.freeze(
		definitions.map((definition, index) =>
			Object.freeze({
				...(definition.name === undefined ? {} : { name: definition.name }),
				sourcePointer: definition.sourcePointer,
				nodeId: definition.node.nodeId,
				...(occurrenceIds[index] === undefined ? {} : { occurrenceId: occurrenceIds[index] }),
			}),
		),
	);
}

function sourceDiagnostics(document: SchemaDocument): readonly SourceDiagnostic[] {
	return Object.freeze(
		document.diagnostics
			.map((item) => Object.freeze({ ...item }))
			.sort(
				(left, right) =>
					left.side.localeCompare(right.side) ||
					left.sourcePointer.localeCompare(right.sourcePointer) ||
					(left.nodeId ?? "").localeCompare(right.nodeId ?? "") ||
					left.code.localeCompare(right.code),
			),
	);
}

function reachableNodeIds(document: SchemaDocument, roots: readonly string[]): ReadonlySet<string> {
	const seen = new Set<string>();
	const pending = [...roots].reverse();
	while (pending.length > 0) {
		const nodeId = pending.pop() as string;
		if (seen.has(nodeId)) continue;
		seen.add(nodeId);
		const node = document.nodes[nodeId];
		if (!node) continue;
		for (const child of nodeReferences(node).reverse()) pending.push(child);
	}
	return seen;
}

function nodeReferences(node: SchemaDocument["nodes"][string]): string[] {
	const refs: string[] = [];
	if (node.kind === "object") {
		refs.push(...node.properties.map((item) => item.node.nodeId));
		if (node.additionalProperties) refs.push(node.additionalProperties.nodeId);
	} else if (node.kind === "array") refs.push(node.items.nodeId);
	else if (node.kind === "tuple")
		refs.push(...node.items.map((item) => item.nodeId), ...(node.rest ? [node.rest.nodeId] : []));
	else if (node.kind === "record") refs.push(node.key.nodeId, node.value.nodeId);
	else if (node.kind === "union") refs.push(...node.alternatives.map((item) => item.nodeId));
	else if (node.kind === "intersection") refs.push(...node.operands.map((item) => item.nodeId));
	else if (node.kind === "ref" && node.target) refs.push(node.target.nodeId);
	else if (node.kind === "wrapper") refs.push(node.inner.nodeId);
	const applicators = node.applicators;
	if (!applicators) return refs;
	for (const value of [
		applicators.if,
		applicators.then,
		applicators.else,
		applicators.not,
		applicators.contains,
		applicators.propertyNames,
	])
		if (value) refs.push(value.nodeId);
	for (const value of Object.values(applicators.patternProperties ?? {})) refs.push(value.nodeId);
	for (const value of Object.values(applicators.dependentSchemas ?? {})) refs.push(value.nodeId);
	return refs;
}

export function mergeProjectionDiagnostics(
	first: readonly ProjectionDiagnostic[],
	second: readonly ProjectionDiagnostic[],
): readonly ProjectionDiagnostic[] {
	return sortProjectionDiagnostics([...first, ...second]);
}
