import type { FieldNode, NodePresentation } from "@formbar/declarative";
import type { DescriptorNode, DescriptorValueRecord } from "../descriptors/contracts.js";

export interface CompiledPresentation {
	readonly widget: string;
	readonly label?: string;
	readonly presentation?: NodePresentation;
	readonly props?: FieldNode["props"];
}

export function presentationFor(node: DescriptorNode, provider: string): CompiledPresentation {
	const annotations = childRecord(node.metadata, "annotations");
	const extensionKey = provider === "json-schema" || provider === "standard-json-schema" ? "x-formbar" : "formbar";
	const formbar = childRecord(childRecord(node.metadata, "extensions"), extensionKey);
	const configuredWidget = formbar?.widget;
	const widget = typeof configuredWidget === "string" ? configuredWidget : defaultWidget(node);
	const configuredLabel = formbar?.label;
	const label =
		typeof configuredLabel === "string"
			? configuredLabel
			: typeof annotations?.title === "string"
				? annotations.title
				: undefined;
	const configuredSpan = formbar?.span;
	const span = validSpan(configuredSpan) ? configuredSpan : undefined;
	const configuredPlaceholder = formbar?.placeholder;
	const placeholder = typeof configuredPlaceholder === "string" ? configuredPlaceholder : undefined;
	return Object.freeze({
		widget,
		...(label === undefined ? {} : { label }),
		...(span === undefined ? {} : { presentation: Object.freeze({ span }) }),
		...(placeholder === undefined
			? {}
			: { props: Object.freeze({ placeholder: Object.freeze({ mode: "literal", value: placeholder }) }) }),
	});
}

function defaultWidget(node: DescriptorNode): string {
	if (node.kind === "enum" || node.kind === "literal") return "select";
	if (node.kind !== "primitive") return "unsupported";
	if (node.type === "boolean") return "checkbox";
	if (node.type === "number" || node.type === "integer" || node.type === "bigint") return "number";
	if (node.type === "date") return "date";
	return "text";
}

function childRecord(value: unknown, key: string): DescriptorValueRecord | undefined {
	if (!isRecord(value)) return undefined;
	const child = value[key];
	return isRecord(child) ? child : undefined;
}

function isRecord(value: unknown): value is DescriptorValueRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validSpan(value: unknown): value is NodePresentation["span"] {
	if (value === "auto" || value === "full") return true;
	if (typeof value === "number") return Number.isInteger(value) && value >= 1 && value <= 12;
	if (!isRecord(value)) return false;
	return Object.entries(value).every(
		([key, span]) =>
			["base", "sm", "md", "lg", "xl"].includes(key) &&
			(span === "auto" ||
				span === "full" ||
				(typeof span === "number" && Number.isInteger(span) && span >= 1 && span <= 12)),
	);
}
