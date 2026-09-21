import type { FieldNode, NodePresentation } from "@formbar/declarative";
import type { DescriptorNode, DescriptorValueRecord } from "../descriptors/contracts.js";

export interface CompiledPresentation {
	readonly widget: string;
	readonly label?: string;
	readonly presentation?: NodePresentation;
	readonly props?: FieldNode["props"];
}

export interface CompiledContainerPresentation {
	readonly title?: string;
	readonly description?: string;
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

export function containerPresentationFor(node: DescriptorNode, provider: string): CompiledContainerPresentation {
	const annotations = provider === "zod3" ? record(node.metadata) : childRecord(node.metadata, "annotations");
	const title = typeof annotations?.title === "string" ? annotations.title : undefined;
	const description = typeof annotations?.description === "string" ? annotations.description : undefined;
	return Object.freeze({
		...(title === undefined ? {} : { title }),
		...(description === undefined ? {} : { description }),
	});
}

function defaultWidget(node: DescriptorNode): string {
	if (node.kind === "enum" || node.kind === "literal") return "select";
	if (node.kind !== "primitive") return "unsupported";
	if (node.type === "boolean") return "checkbox";
	if (node.type === "number" || node.type === "integer") return "number";
	if (node.type === "date") return "date";
	return "text";
}

function childRecord(value: unknown, key: string): DescriptorValueRecord | undefined {
	const child = record(value)?.[key];
	return record(child);
}

function record(value: unknown): DescriptorValueRecord | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as DescriptorValueRecord)
		: undefined;
}

function validSpan(value: unknown): value is NodePresentation["span"] {
	if (value === "auto" || value === "full") return true;
	if (typeof value === "number") return Number.isInteger(value) && value >= 1 && value <= 12;
	const values = record(value);
	if (!values) return false;
	return Object.entries(values).every(
		([key, span]) =>
			["base", "sm", "md", "lg", "xl"].includes(key) &&
			(span === "auto" ||
				span === "full" ||
				(typeof span === "number" && Number.isInteger(span) && span >= 1 && span <= 12)),
	);
}
