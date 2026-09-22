import type { FormNode, RuntimeFieldBaseline, StateRef, ValidatedFormDefinition } from "@formbar/declarative";
import type {
	DescriptorDocument,
	DescriptorNode,
	DescriptorOccurrence,
	OccurrencePathSegment,
} from "./descriptors/contracts.js";
import type { CompilationDiagnostic } from "./diagnostics.js";
import { sortCompilationDiagnostics } from "./diagnostics.js";

interface FieldPattern {
	readonly nodeId: string;
	readonly path: readonly OccurrencePathSegment[];
}

interface PatternFrame {
	readonly scopes: Readonly<Record<string, StateRef>>;
}

export interface RuntimeBaselineAdaptation {
	readonly baseline: readonly RuntimeFieldBaseline[];
	readonly diagnostics: readonly CompilationDiagnostic[];
}

export function createRuntimeFieldBaseline(
	document: DescriptorDocument,
	definition: ValidatedFormDefinition,
): readonly RuntimeFieldBaseline[] {
	return adaptRuntimeFieldBaseline(document, definition).baseline;
}

export function adaptRuntimeFieldBaseline(
	document: DescriptorDocument,
	definition: ValidatedFormDefinition,
): RuntimeBaselineAdaptation {
	const diagnostics: CompilationDiagnostic[] = [];
	const baseline = fieldPatterns(definition.root).flatMap((field) => {
		const matches = matchingOccurrences(document, field.path);
		if (!matches.length) return [];
		const labels = distinctLabels(document, matches);
		if (labels.length > 1) diagnostics.push(conflictingLabelDiagnostic(field.nodeId, matches[0]));
		return [
			Object.freeze({
				nodeId: field.nodeId,
				required: matches.some((occurrence) => occurrence.presence === "required"),
				...(labels.length === 1 ? { label: labels[0] } : {}),
			}),
		];
	});
	return Object.freeze({ baseline: Object.freeze(baseline), diagnostics: sortCompilationDiagnostics(diagnostics) });
}

function fieldPatterns(root: FormNode): readonly FieldPattern[] {
	const output: FieldPattern[] = [];
	visitNode(root, { scopes: Object.freeze({}) }, output);
	return output;
}

function visitNode(node: FormNode, frame: PatternFrame, output: FieldPattern[]): void {
	if (node.type === "field") {
		const binding = safeResolve(node.binding, frame.scopes);
		if (binding?.namespace === "data") output.push({ nodeId: node.id, path: binding.segments });
	}
	if (node.type === "repeater") {
		visitRepeater(node, frame, output);
		return;
	}
	if (node.type === "conditional") {
		for (const child of [...node.then, ...(node.else ?? [])]) visitNode(child, frame, output);
		return;
	}
	for (const child of nodeChildren(node)) visitNode(child, frame, output);
}

function visitRepeater(
	node: Extract<FormNode, { type: "repeater" }>,
	frame: PatternFrame,
	output: FieldPattern[],
): void {
	const binding = safeResolve(node.binding, frame.scopes);
	if (!binding) return;
	const item = Object.freeze({ namespace: binding.namespace, segments: Object.freeze([...binding.segments, "*"]) });
	const scopes = Object.freeze({ ...frame.scopes, [node.scope]: item });
	for (const child of node.children) visitNode(child, { scopes }, output);
}

function nodeChildren(node: FormNode): readonly FormNode[] {
	if (node.type === "group" || node.type === "section") return node.children;
	if (node.type === "tabs") return node.tabs.flatMap((tab) => tab.children);
	if (node.type === "accordion") return node.items.flatMap((item) => item.children);
	if (node.type === "custom") return node.children ?? [];
	return [];
}

function safeResolve(binding: StateRef, scopes: Readonly<Record<string, StateRef>>): StateRef | undefined {
	if (!binding.scope)
		return Object.freeze({ namespace: binding.namespace, segments: Object.freeze([...binding.segments]) });
	const parent = scopes[binding.scope];
	if (!parent || parent.namespace !== binding.namespace) return undefined;
	return Object.freeze({
		namespace: binding.namespace,
		segments: Object.freeze([...parent.segments, ...binding.segments]),
	});
}

function matchingOccurrences(
	document: DescriptorDocument,
	path: readonly OccurrencePathSegment[],
): readonly DescriptorOccurrence[] {
	return Object.values(document.occurrences)
		.filter(
			(occurrence) =>
				occurrence.path.length === path.length && occurrence.path.every((segment, index) => segment === path[index]),
		)
		.sort((left, right) => left.id.localeCompare(right.id));
}

function distinctLabels(document: DescriptorDocument, occurrences: readonly DescriptorOccurrence[]): readonly string[] {
	return [
		...new Set(
			occurrences
				.map((occurrence) => schemaTitle(document.nodes[occurrence.nodeId], document.source.provider))
				.filter((label): label is string => label !== undefined),
		),
	];
}

function schemaTitle(node: DescriptorNode | undefined, provider: string): string | undefined {
	if (!node || typeof node.metadata !== "object" || node.metadata === null || Array.isArray(node.metadata))
		return undefined;
	const metadata = node.metadata as Readonly<Record<string, unknown>>;
	const source = provider === "zod3" ? metadata : metadata.annotations;
	if (typeof source !== "object" || source === null || Array.isArray(source)) return undefined;
	const title = (source as Readonly<Record<string, unknown>>).title;
	return typeof title === "string" ? title : undefined;
}

function conflictingLabelDiagnostic(nodeId: string, occurrence: DescriptorOccurrence): CompilationDiagnostic {
	return Object.freeze({
		code: "conflicting-baseline-label",
		severity: "warning",
		occurrenceId: occurrence.id,
		nodeId,
		message: "Conflicting schema titles were omitted from the runtime baseline.",
	});
}
