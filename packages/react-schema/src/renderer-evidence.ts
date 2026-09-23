import { toDot, toPointer } from "@formbar/core";
import type {
	Binding,
	ColumnSpan,
	FieldNode,
	JsonValue,
	ResolvedFieldState,
	ResponsiveSpan,
} from "@formbar/declarative";
import type { DescriptorDocument, DescriptorOccurrence, NormalizedEvidence } from "@formbar/from-schema";

export type RendererDiagnostic =
	| "duplicate-extension-id"
	| "extension-child-failed"
	| "extension-render-failed"
	| "extension-validator-failed"
	| "invalid-extension-props"
	| "invalid-extension-registration"
	| "missing-extension"
	| "reserved-widget-id"
	| "unsupported-node"
	| "unsupported-widget"
	| "unsupported-binding"
	| "unsupported-options"
	| "conditional-unresolved"
	| "output-unresolved"
	| "unsupported-output-value";

export type ScalarOption = string | number | boolean | null;

export type OptionEvidence =
	| { readonly ok: true; readonly values: readonly ScalarOption[] }
	| { readonly ok: false; readonly values: readonly [] };

export type FieldRenderEvidence =
	| { readonly ok: false; readonly diagnostic: RendererDiagnostic }
	| {
			readonly ok: true;
			readonly kind: "native";
			readonly path: string;
			readonly evidence: NormalizedEvidence;
			readonly widget: string;
	  }
	| {
			readonly ok: true;
			readonly kind: "options";
			readonly path: string;
			readonly evidence: NormalizedEvidence;
			readonly widget: "select" | "radio";
			readonly options: readonly ScalarOption[];
	  };

export interface SpanOutput {
	readonly attributes: Readonly<Record<string, string>>;
	readonly style: Readonly<Record<string, string>>;
}

const DOT_SAFE_SEGMENT = /^[a-zA-Z0-9_-]+$/;
const NUMERIC_SEGMENT = /^(?:0|[1-9]\d*)$/;
const BREAKPOINTS = ["base", "sm", "md", "lg", "xl"] as const;
const STRING_FORMATS = new Set(["email", "url", "tel", "date", "time"]);
const MAX_NATIVE_DATE = { year: "275760", monthDay: "09-13" } as const;
const occurrenceParentCache = new WeakMap<DescriptorDocument, ReadonlyMap<string, DescriptorOccurrence>>();
export const NATIVE_WIDGET_IDS = new Set([
	"text",
	"textarea",
	"number",
	"select",
	"checkbox",
	"radio",
	"date",
	"time",
	"email",
	"url",
	"tel",
	"password",
	"search",
]);

export function editablePath(binding: Binding): string | undefined {
	if (binding.scope || binding.segments.length === 0) return undefined;
	if (binding.namespace === "data") return toPointer({ namespace: "data", segments: binding.segments });
	if (binding.namespace !== "ui" || !binding.segments.every(dotSafe)) return undefined;
	return toDot({ namespace: "ui", segments: binding.segments });
}

export function descriptorEvidence(document: DescriptorDocument, binding: Binding): NormalizedEvidence {
	if (binding.namespace !== "data") return Object.freeze({});
	const matches = Object.values(document.occurrences)
		.filter((occurrence) => occurrenceMatches(document, occurrence, binding.segments))
		.sort((left, right) => left.id.localeCompare(right.id));
	const merged: NormalizedEvidence = {};
	for (const occurrence of matches) Object.assign(merged, document.evidence[occurrence.nodeId]);
	return Object.freeze(merged);
}

export function descriptorDescription(document: DescriptorDocument, binding: Binding): string | undefined {
	if (binding.namespace !== "data") return undefined;
	const occurrence = Object.values(document.occurrences)
		.filter((candidate) => occurrenceMatches(document, candidate, binding.segments))
		.sort((left, right) => left.id.localeCompare(right.id))[0];
	if (!occurrence) return undefined;
	const metadata = record(document.nodes[occurrence.nodeId]?.metadata);
	const annotations = record(metadata?.annotations) ?? metadata;
	return typeof annotations?.description === "string" ? annotations.description : undefined;
}

export function literalProp(field: Pick<FieldNode, "props">, key: string): JsonValue | undefined {
	const spec = field.props?.[key];
	return spec?.mode === "literal" ? spec.value : undefined;
}

export function optionEvidence(node: Pick<FieldNode, "props">, evidence: NormalizedEvidence): OptionEvidence {
	const authored = literalProp(node, "options");
	if (authored !== undefined) return scalarOptions(authored);
	if (evidence.enum) return scalarOptions(evidence.enum);
	if (evidence.literal !== undefined) return scalarOptions([evidence.literal]);
	return { ok: false, values: [] };
}

export function nativeInputType(widget: string, evidence: NormalizedEvidence): string {
	if (widget !== "text") return widget;
	const format = evidence.format;
	return format && STRING_FORMATS.has(format) ? format : "text";
}

export function conformingValue(
	widget: string,
	value: JsonValue | undefined,
	options?: readonly ScalarOption[],
): boolean {
	if (value === undefined) return true;
	if (widget === "number") return typeof value === "number" && Number.isFinite(value);
	if (widget === "checkbox") return typeof value === "boolean";
	if (widget === "select" || widget === "radio") return options?.some((item) => Object.is(item, value)) === true;
	if (typeof value !== "string") return false;
	if (widget === "date") return validDate(value);
	if (widget === "time") return validTime(value);
	return true;
}

export function resolveFieldEvidence(
	node: FieldNode,
	state: ResolvedFieldState,
	document: DescriptorDocument,
): FieldRenderEvidence {
	const path = editablePath(state.binding);
	if (!path) return { ok: false, diagnostic: "unsupported-binding" };
	if (!NATIVE_WIDGET_IDS.has(node.widget)) return { ok: false, diagnostic: "unsupported-widget" };
	const evidence = descriptorEvidence(document, state.binding);
	if (node.widget === "select" || node.widget === "radio") {
		const options = optionEvidence(node, evidence);
		if (!options.ok || !conformingValue(node.widget, state.value, options.values))
			return { ok: false, diagnostic: "unsupported-options" };
		return { ok: true, kind: "options", path, evidence, widget: node.widget, options: options.values };
	}
	const widget = nativeInputType(node.widget, evidence);
	if (!conformingValue(widget, state.value)) return { ok: false, diagnostic: "unsupported-widget" };
	return { ok: true, kind: "native", path, evidence, widget };
}

export function focusableField(node: FieldNode, state: ResolvedFieldState, document: DescriptorDocument): boolean {
	if (!state.visible || state.disabled) return false;
	if (state.readOnly && ["select", "checkbox", "radio"].includes(node.widget)) return false;
	return resolveFieldEvidence(node, state, document).ok;
}

export function domIdToken(value: string): string {
	let token = "u";
	for (let index = 0; index < value.length; index++) token += value.charCodeAt(index).toString(16).padStart(4, "0");
	return token;
}

export function spanOutput(span: ResponsiveSpan | undefined): SpanOutput | undefined {
	if (span === undefined) return undefined;
	const values = typeof span === "object" ? span : { base: span };
	const attributes: Record<string, string> = {};
	const style: Record<string, string> = {};
	for (const breakpoint of BREAKPOINTS) {
		const raw = values[breakpoint];
		if (raw === undefined) continue;
		const value = spanValue(raw);
		attributes[`data-formbar-span-${breakpoint}`] = value;
		style[`--formbar-span-${breakpoint}`] = value;
	}
	return { attributes, style };
}

function scalarOptions(value: JsonValue | readonly JsonValue[]): OptionEvidence {
	if (!Array.isArray(value)) return scalar(value) ? { ok: true, values: [value] } : { ok: false, values: [] };
	if (value.length === 0) return { ok: false, values: [] };
	const options: ScalarOption[] = [];
	for (const item of value) {
		if (!scalar(item)) return { ok: false, values: [] };
		options.push(item);
	}
	return { ok: true, values: Object.freeze(options) };
}

function scalar(value: JsonValue): value is ScalarOption {
	return (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean" ||
		(typeof value === "number" && Number.isFinite(value))
	);
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Readonly<Record<string, unknown>>)
		: undefined;
}

function occurrenceMatches(
	document: DescriptorDocument,
	occurrence: DescriptorOccurrence,
	concrete: readonly (string | number)[],
): boolean {
	if (occurrence.path.length !== concrete.length) return false;
	const wildcards = wildcardIndexes(document, occurrence);
	return occurrence.path.every((segment, index) =>
		wildcards.has(index) ? typeof concrete[index] === "number" : segment === concrete[index],
	);
}

function wildcardIndexes(document: DescriptorDocument, occurrence: DescriptorOccurrence): ReadonlySet<number> {
	const parents = occurrenceParents(document);
	const indexes = new Set<number>();
	let current: DescriptorOccurrence | undefined = occurrence;
	while (current) {
		if ((current.relation === "items" || current.relation === "tuple-rest") && current.path.at(-1) === "*") {
			indexes.add(current.path.length - 1);
		}
		current = parents.get(current.id);
	}
	return indexes;
}

function occurrenceParents(document: DescriptorDocument): ReadonlyMap<string, DescriptorOccurrence> {
	const cached = occurrenceParentCache.get(document);
	if (cached) return cached;
	const parents = new Map<string, DescriptorOccurrence>();
	for (const candidate of Object.values(document.occurrences)) {
		for (const child of candidate.children) {
			const childOccurrence = document.occurrences[child];
			if (childOccurrence) parents.set(child, candidate);
		}
	}
	occurrenceParentCache.set(document, parents);
	return parents;
}

function dotSafe(segment: string | number): boolean {
	const value = String(segment);
	return DOT_SAFE_SEGMENT.test(value) && !(typeof segment === "string" && NUMERIC_SEGMENT.test(value));
}

function spanValue(value: ColumnSpan): string {
	return value === "full" ? "12" : String(value);
}

function validDate(value: string): boolean {
	const match = /^(\d{4,})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return false;
	const normalizedYear = match[1].replace(/^0+/, "");
	if (!normalizedYear || !withinNativeDateRange(normalizedYear, match[2], match[3])) return false;
	const year = Number(normalizedYear);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
	return month >= 1 && month <= 12 && day >= 1 && day <= (days[month - 1] ?? 0);
}

function withinNativeDateRange(year: string, month: string, day: string): boolean {
	if (year.length < MAX_NATIVE_DATE.year.length) return true;
	if (year.length > MAX_NATIVE_DATE.year.length || year > MAX_NATIVE_DATE.year) return false;
	return year < MAX_NATIVE_DATE.year || `${month}-${day}` <= MAX_NATIVE_DATE.monthDay;
}

function validTime(value: string): boolean {
	const match = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/.exec(value);
	return Boolean(match && Number(match[1]) < 24 && Number(match[2]) < 60 && Number(match[3] ?? 0) < 60);
}
