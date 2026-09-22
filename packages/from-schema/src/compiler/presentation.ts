import type { FieldNode, JsonValue, NodePresentation } from "@formbar/declarative";
import { copyJson } from "@formbar/expressions";
import type { DescriptorNode, DescriptorValueRecord } from "../descriptors/contracts.js";
import { jsonPresentationHint } from "../json-presentation-hints.js";

export interface CompiledPresentation {
	readonly widget: string;
	readonly explicitWidget: boolean;
	readonly label?: string;
	readonly presentation?: NodePresentation;
	readonly props?: FieldNode["props"];
	readonly invalidProps?: boolean;
	readonly invalidWidget?: boolean;
}

export interface CompiledContainerPresentation {
	readonly title?: string;
	readonly description?: string;
}

export function presentationFor(node: DescriptorNode, provider: string): CompiledPresentation {
	const annotations = childRecord(node.metadata, "annotations");
	const captured = provider === "json-schema" ? jsonPresentationHint(node.metadata) : { status: "absent" as const };
	const formbar =
		captured.status === "valid"
			? captured.value
			: provider === "json-schema" || provider === "standard-json-schema"
				? undefined
				: childRecord(childRecord(node.metadata, "extensions"), "formbar");
	const hasWidget = formbar ? Object.hasOwn(formbar, "widget") : false;
	const configuredWidget = safeId(formbar?.widget) ? formbar.widget : undefined;
	const invalidWidget = hasWidget && configuredWidget === undefined;
	const widget = configuredWidget ?? defaultWidget(node);
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
	const compiledProps = captured.status === "invalid" ? { invalid: true } : extensionProps(formbar?.props);
	const description = typeof annotations?.description === "string" ? annotations.description : undefined;
	const props = mergeProps(compiledProps.props, placeholder, description);
	return Object.freeze({
		widget,
		explicitWidget: configuredWidget !== undefined || invalidWidget || compiledProps.invalid,
		...(label === undefined ? {} : { label }),
		...(span === undefined ? {} : { presentation: Object.freeze({ span }) }),
		...(props ? { props } : {}),
		...(compiledProps.invalid ? { invalidProps: true } : {}),
		...(invalidWidget ? { invalidWidget: true } : {}),
	});
}

function extensionProps(value: unknown): { readonly props?: FieldNode["props"]; readonly invalid: boolean } {
	if (value === undefined) return { invalid: false };
	let copied: JsonValue;
	try {
		copied = copyJson(value);
	} catch {
		return { invalid: true };
	}
	if (!jsonRecord(copied)) return { invalid: true };
	const output: Record<string, NonNullable<FieldNode["props"]>[string]> = Object.create(null);
	for (const [key, item] of Object.entries(copied)) {
		if (!safeId(key)) return { invalid: true };
		output[key] = Object.freeze({ mode: "literal", value: item });
	}
	return { props: Object.freeze(output), invalid: false };
}

function mergeProps(
	props: FieldNode["props"],
	placeholder: string | undefined,
	description: string | undefined,
): FieldNode["props"] {
	const output = { ...(props ?? {}) };
	if (placeholder !== undefined && output.placeholder === undefined)
		output.placeholder = Object.freeze({ mode: "literal", value: placeholder });
	if (description !== undefined && output.description === undefined)
		output.description = Object.freeze({ mode: "literal", value: description });
	return Object.keys(output).length ? Object.freeze(output) : undefined;
}

function jsonRecord(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeId(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 256 &&
		value !== "__proto__" &&
		value !== "constructor" &&
		value !== "prototype"
	);
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
