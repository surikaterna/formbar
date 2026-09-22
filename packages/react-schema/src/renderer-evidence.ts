import { toDot, toPointer } from "@formbar/core";
import type { Binding, ColumnSpan, JsonValue, ResponsiveSpan } from "@formbar/declarative";
import type { DescriptorDocument, NormalizedEvidence } from "@formbar/from-schema";

export type RendererDiagnostic =
	| "unsupported-node"
	| "unsupported-widget"
	| "unsupported-binding"
	| "unsupported-options"
	| "conditional-unresolved";

export type ScalarOption = string | number | boolean | null;

export interface OptionEvidence {
	readonly ok: boolean;
	readonly values: readonly ScalarOption[];
}

export interface SpanOutput {
	readonly attributes: Readonly<Record<string, string>>;
	readonly style: Readonly<Record<string, string>>;
}

const DOT_SAFE_SEGMENT = /^[a-zA-Z0-9_-]+$/;
const NUMERIC_SEGMENT = /^(?:0|[1-9]\d*)$/;
const BREAKPOINTS = ["base", "sm", "md", "lg", "xl"] as const;

export function editablePath(binding: Binding): string | undefined {
	if (binding.scope || binding.segments.length === 0) return undefined;
	if (binding.namespace === "data") return toPointer({ namespace: "data", segments: binding.segments });
	if (binding.namespace !== "ui" || !binding.segments.every(dotSafe)) return undefined;
	return toDot({ namespace: "ui", segments: binding.segments });
}

export function descriptorEvidence(document: DescriptorDocument, binding: Binding): NormalizedEvidence {
	const matches = Object.values(document.occurrences)
		.filter((occurrence) => samePath(occurrence.path, binding.segments))
		.sort((left, right) => left.id.localeCompare(right.id));
	const merged: Record<string, unknown> = {};
	for (const occurrence of matches) Object.assign(merged, document.evidence[occurrence.nodeId]);
	return Object.freeze(merged) as NormalizedEvidence;
}

export function literalProp(
	binding: { readonly props?: Readonly<Record<string, unknown>> },
	key: string,
): JsonValue | undefined {
	const spec = binding.props?.[key];
	if (!spec || typeof spec !== "object" || !("mode" in spec) || !("value" in spec)) return undefined;
	return spec.mode === "literal" ? (spec.value as JsonValue) : undefined;
}

export function optionEvidence(
	node: { readonly props?: Readonly<Record<string, unknown>> },
	evidence: NormalizedEvidence,
): OptionEvidence {
	const authored = literalProp(node, "options");
	if (authored !== undefined) return scalarOptions(authored);
	if (evidence.enum) return scalarOptions(evidence.enum);
	if (evidence.literal !== undefined) return scalarOptions([evidence.literal]);
	return { ok: false, values: [] };
}

export function nativeInputType(widget: string, evidence: NormalizedEvidence): string {
	if (widget !== "text") return widget;
	return ["email", "url", "tel", "date", "time"].includes(evidence.format ?? "") ? (evidence.format as string) : "text";
}

export function conformingValue(widget: string, value: JsonValue | undefined, options?: OptionEvidence): boolean {
	if (value === undefined) return true;
	if (widget === "number") return typeof value === "number" && Number.isFinite(value);
	if (widget === "checkbox") return typeof value === "boolean";
	if (widget === "select" || widget === "radio") return options?.values.some((item) => Object.is(item, value)) === true;
	if (typeof value !== "string") return false;
	if (widget === "date") return validDate(value);
	if (widget === "time") return validTime(value);
	return true;
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
	return value.length > 0 && value.every(scalar)
		? { ok: true, values: Object.freeze([...value]) as readonly ScalarOption[] }
		: { ok: false, values: [] };
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
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
	return month >= 1 && month <= 12 && day >= 1 && day <= (days[month - 1] ?? 0);
}

function validTime(value: string): boolean {
	const match = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(value);
	return Boolean(match && Number(match[1]) < 24 && Number(match[2]) < 60 && Number(match[3] ?? 0) < 60);
}
