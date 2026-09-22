import { toDot, toPointer } from "@formbar/core";
import type {
	Binding,
	ColumnSpan,
	FieldNode,
	JsonValue,
	ResolvedFieldState,
	ResponsiveSpan,
} from "@formbar/declarative";
import type { DescriptorDocument, NormalizedEvidence } from "@formbar/from-schema";

export type RendererDiagnostic =
	| "unsupported-node"
	| "unsupported-widget"
	| "unsupported-binding"
	| "unsupported-options"
	| "conditional-unresolved";

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
const WIDGETS = new Set([
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
		.filter((occurrence) => samePath(occurrence.path, binding.segments))
		.sort((left, right) => left.id.localeCompare(right.id));
	const merged: NormalizedEvidence = {};
	for (const occurrence of matches) Object.assign(merged, document.evidence[occurrence.nodeId]);
	return Object.freeze(merged);
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
	const path = editablePath(node.binding);
	if (!path) return { ok: false, diagnostic: "unsupported-binding" };
	if (!WIDGETS.has(node.widget)) return { ok: false, diagnostic: "unsupported-widget" };
	const evidence = descriptorEvidence(document, node.binding);
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

function samePath(left: readonly (string | number | "*")[], right: readonly (string | number)[]): boolean {
	return left.length === right.length && left.every((segment, index) => segment === right[index]);
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
