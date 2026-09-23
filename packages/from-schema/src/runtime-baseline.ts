import type {
	FormNode,
	RuntimeFieldBaseline,
	RuntimeRepeaterBaseline,
	StateRef,
	ValidatedFormDefinition,
} from "@formbar/declarative";
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

type RepeaterPattern = FieldPattern;

interface PatternFrame {
	readonly scopes: Readonly<Record<string, StateRef>>;
}

export interface RuntimeBaselineAdaptation {
	readonly baseline: readonly RuntimeFieldBaseline[];
	readonly repeaterBaseline: readonly RuntimeRepeaterBaseline[];
	readonly diagnostics: readonly CompilationDiagnostic[];
}

export function createRuntimeFieldBaseline(
	document: DescriptorDocument,
	definition: ValidatedFormDefinition,
): readonly RuntimeFieldBaseline[] {
	return adaptRuntimeFieldBaseline(document, definition).baseline;
}

export function createRuntimeRepeaterBaseline(
	document: DescriptorDocument,
	definition: ValidatedFormDefinition,
): readonly RuntimeRepeaterBaseline[] {
	return adaptRuntimeFieldBaseline(document, definition).repeaterBaseline;
}

export function adaptRuntimeFieldBaseline(
	document: DescriptorDocument,
	definition: ValidatedFormDefinition,
): RuntimeBaselineAdaptation {
	const diagnostics: CompilationDiagnostic[] = [];
	const patterns = runtimePatterns(definition.root);
	const baseline = patterns.fields.flatMap((field) => {
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
	const repeaterBaseline = patterns.repeaters.flatMap((repeater) => {
		const matches = matchingOccurrences(document, repeater.path);
		if (!matches.length) return [];
		const labels = distinctLabels(document, matches);
		if (labels.length > 1) diagnostics.push(conflictingLabelDiagnostic(repeater.nodeId, matches[0]));
		const evidence = matches.map((occurrence) => document.evidence[occurrence.nodeId]);
		const minimums = evidence.flatMap((item) => (item?.minItems === undefined ? [] : [item.minItems]));
		const maximums = evidence.flatMap((item) => (item?.maxItems === undefined ? [] : [item.maxItems]));
		return [
			Object.freeze({
				nodeId: repeater.nodeId,
				...(minimums.length ? { minItems: Math.max(...minimums) } : {}),
				...(maximums.length ? { maxItems: Math.min(...maximums) } : {}),
				...(labels.length === 1 ? { label: labels[0] } : {}),
			}),
		];
	});
	return Object.freeze({
		baseline: Object.freeze(baseline),
		repeaterBaseline: Object.freeze(repeaterBaseline),
		diagnostics: sortCompilationDiagnostics(diagnostics),
	});
}

function runtimePatterns(root: FormNode): {
	readonly fields: readonly FieldPattern[];
	readonly repeaters: readonly RepeaterPattern[];
} {
	const fields: FieldPattern[] = [];
	const repeaters: RepeaterPattern[] = [];
	visitNode(root, { scopes: Object.freeze({}) }, fields, repeaters);
	return { fields, repeaters };
}

function visitNode(node: FormNode, frame: PatternFrame, fields: FieldPattern[], repeaters: RepeaterPattern[]): void {
	if (node.type === "field") {
		const binding = safeResolve(node.binding, frame.scopes);
		if (binding?.namespace === "data") fields.push({ nodeId: node.id, path: binding.segments });
	}
	if (node.type === "repeater") {
		visitRepeater(node, frame, fields, repeaters);
		return;
	}
	if (node.type === "conditional") {
		for (const child of [...node.then, ...(node.else ?? [])]) visitNode(child, frame, fields, repeaters);
		return;
	}
	for (const child of nodeChildren(node)) visitNode(child, frame, fields, repeaters);
}

function visitRepeater(
	node: Extract<FormNode, { type: "repeater" }>,
	frame: PatternFrame,
	fields: FieldPattern[],
	repeaters: RepeaterPattern[],
): void {
	const binding = safeResolve(node.binding, frame.scopes);
	if (!binding) return;
	if (binding.namespace === "data") repeaters.push({ nodeId: node.id, path: binding.segments });
	const item = Object.freeze({ namespace: binding.namespace, segments: Object.freeze([...binding.segments, "*"]) });
	const scopes = Object.freeze({ ...frame.scopes, [node.scope]: item });
	for (const child of node.children) visitNode(child, { scopes }, fields, repeaters);
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
