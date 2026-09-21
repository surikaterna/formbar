import type { DescriptorNode, DescriptorValueRecord, NormalizedEvidence } from "./contracts.js";

export function normalizedEvidence(node: DescriptorNode): NormalizedEvidence {
	const constraints = record(node.constraints);
	const annotation = annotationRecord(node.metadata);
	return Object.freeze({
		...(node.kind === "primitive" ? { primitive: node.type } : {}),
		...(node.kind === "literal" ? { literal: node.value } : {}),
		...(node.kind === "enum" ? { enum: node.values } : {}),
		...(node.kind === "wrapper" && node.wrapper === "default" && node.value !== undefined
			? { default: node.value }
			: annotation?.default !== undefined
				? { default: annotation.default }
				: {}),
		...numberEvidence(constraints, "minimum"),
		...numberEvidence(constraints, "maximum"),
		...numberEvidence(constraints, "exclusiveMinimum"),
		...numberEvidence(constraints, "exclusiveMaximum"),
		...numberEvidence(constraints, "minLength"),
		...numberEvidence(constraints, "maxLength"),
		...numberEvidence(constraints, "minItems"),
		...numberEvidence(constraints, "maxItems"),
		...stringEvidence(constraints, "pattern"),
		...stringEvidence(constraints, "format"),
	});
}

function record(value: unknown): DescriptorValueRecord | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as DescriptorValueRecord)
		: undefined;
}

function annotationRecord(metadata: unknown): DescriptorValueRecord | undefined {
	return record(record(metadata)?.annotations);
}

function numberEvidence<Key extends keyof NormalizedEvidence>(
	source: DescriptorValueRecord | undefined,
	key: Key,
): Partial<NormalizedEvidence> {
	const value = source?.[key];
	return typeof value === "number" && Number.isFinite(value) ? { [key]: value } : {};
}

function stringEvidence<Key extends "pattern" | "format">(
	source: DescriptorValueRecord | undefined,
	key: Key,
): Partial<NormalizedEvidence> {
	const value = source?.[key];
	return typeof value === "string" ? { [key]: value } : {};
}
