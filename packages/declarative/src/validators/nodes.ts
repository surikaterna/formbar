import type { Expression, JsonValue, Scopes } from "@formbar/expressions";
import type { DiagnosticPathSegment } from "../diagnostics.js";
import type { BaseNode, FormNode, OutputFormat } from "../nodes.js";
import { actionNode } from "./actions.js";
import { binding } from "./bindings.js";
import { type NodeContext, diagnostic } from "./context.js";
import { expression, props } from "./expressions.js";
import { presentation } from "./presentation.js";
import { type JsonRecord, array, exactKeys, identifier, optionalInteger, optionalString, record } from "./shape.js";

const BASE_KEYS = ["id", "type", "visible", "disabled", "readOnly", "presentation"];
const KEYS: Readonly<Record<string, readonly string[]>> = Object.freeze({
	group: ["label", "children"],
	section: ["title", "description", "children"],
	field: ["binding", "widget", "label", "required", "props", "submitWhenHidden"],
	repeater: ["binding", "scope", "label", "children", "minItems", "maxItems"],
	action: ["action", "label", "payload", "concurrency", "target", "props"],
	output: ["value", "label", "format", "props"],
	conditional: ["condition", "then", "else"],
	tabs: ["tabs"],
	accordion: ["items"],
	validation: ["binding", "messages"],
	custom: ["renderer", "props", "children"],
});

export function node(
	value: JsonValue | undefined,
	path: readonly DiagnosticPathSegment[],
	context: NodeContext,
): FormNode | undefined {
	if (value === undefined) {
		diagnostic(context, "required", path, "Expected a node.");
		return undefined;
	}
	const source = record(value, path, context);
	if (!source) return undefined;
	const type = source.type;
	if (typeof type !== "string" || !Object.hasOwn(KEYS, type)) {
		diagnostic(context, "unknown-node-type", [...path, "type"], "Expected a supported node type.");
		return undefined;
	}
	exactKeys(source, new Set([...BASE_KEYS, ...(KEYS[type] ?? [])]), path, context);
	const base = baseNode(source, path, context);
	if (!base) return undefined;
	return specificNode(type, source, path, context, base);
}

function baseNode(
	source: JsonRecord,
	path: readonly DiagnosticPathSegment[],
	context: NodeContext,
): BaseNode | undefined {
	const id = identifier(source.id, [...path, "id"], context);
	if (id) registerId(id, [...path, "id"], context);
	const visible = optionalExpression(source.visible, [...path, "visible"], context);
	const disabled = optionalExpression(source.disabled, [...path, "disabled"], context);
	const readOnly = optionalExpression(source.readOnly, [...path, "readOnly"], context);
	const layout = presentation(source.presentation, [...path, "presentation"], context);
	if (!id) return undefined;
	return Object.freeze({
		id,
		...(visible ? { visible } : {}),
		...(disabled ? { disabled } : {}),
		...(readOnly ? { readOnly } : {}),
		...(layout ? { presentation: layout } : {}),
	});
}

function specificNode(
	type: string,
	source: JsonRecord,
	path: readonly DiagnosticPathSegment[],
	context: NodeContext,
	base: BaseNode,
): FormNode | undefined {
	if (type === "group" || type === "section") return containerNode(type, source, path, context, base);
	if (type === "field") return fieldNode(source, path, context, base);
	if (type === "repeater") return repeaterNode(source, path, context, base);
	if (type === "action") return actionNode(source, path, context, base);
	if (type === "output") return outputNode(source, path, context, base);
	if (type === "conditional") return conditionalNode(source, path, context, base);
	if (type === "tabs" || type === "accordion") return collectionNode(type, source, path, context, base);
	if (type === "validation") return validationNode(source, path, context, base);
	return customNode(source, path, context, base);
}

function containerNode(
	type: "group" | "section",
	source: JsonRecord,
	path: readonly DiagnosticPathSegment[],
	context: NodeContext,
	base: BaseNode,
): FormNode | undefined {
	const children = childNodes(source.children, [...path, "children"], context);
	if (!children) return undefined;
	if (type === "group") {
		const label = optionalString(source.label, [...path, "label"], context);
		return Object.freeze({ ...base, type, ...(label === undefined ? {} : { label }), children });
	}
	const title = optionalString(source.title, [...path, "title"], context);
	const description = optionalString(source.description, [...path, "description"], context);
	return Object.freeze({
		...base,
		type,
		...(title === undefined ? {} : { title }),
		...(description === undefined ? {} : { description }),
		children,
	});
}

function fieldNode(
	source: JsonRecord,
	path: readonly DiagnosticPathSegment[],
	context: NodeContext,
	base: BaseNode,
): FormNode | undefined {
	const target = binding(source.binding, [...path, "binding"], context.scopes, context);
	const widget = identifier(source.widget, [...path, "widget"], context);
	const label = optionalString(source.label, [...path, "label"], context);
	const required = optionalExpression(source.required, [...path, "required"], context);
	const definitions = props(source.props, [...path, "props"], context.scopes, context);
	const submitWhenHidden = source.submitWhenHidden;
	if (submitWhenHidden !== undefined && submitWhenHidden !== "include")
		diagnostic(context, "invalid-type", [...path, "submitWhenHidden"], "Expected include.");
	if (!target || !widget) return undefined;
	return Object.freeze({
		...base,
		type: "field",
		binding: target,
		widget,
		...(label === undefined ? {} : { label }),
		...(required ? { required } : {}),
		...(definitions ? { props: definitions } : {}),
		...(submitWhenHidden === "include" ? { submitWhenHidden } : {}),
	});
}

function repeaterNode(
	source: JsonRecord,
	path: readonly DiagnosticPathSegment[],
	context: NodeContext,
	base: BaseNode,
): FormNode | undefined {
	const target = binding(source.binding, [...path, "binding"], context.scopes, context);
	const scope = identifier(source.scope, [...path, "scope"], context);
	const label = optionalString(source.label, [...path, "label"], context);
	const minItems = optionalInteger(source.minItems, [...path, "minItems"], context);
	const maxItems = optionalInteger(source.maxItems, [...path, "maxItems"], context);
	if (minItems !== undefined && maxItems !== undefined && minItems > maxItems)
		diagnostic(context, "invalid-range", [...path, "maxItems"], "maxItems must be greater than or equal to minItems.");
	const nested = target && scope ? nestedContext(scope, target, [...path, "scope"], context) : context;
	const children = childNodes(source.children, [...path, "children"], nested);
	if (!target || !scope || !children) return undefined;
	return Object.freeze({
		...base,
		type: "repeater",
		binding: target,
		scope,
		...(label === undefined ? {} : { label }),
		children,
		...(minItems === undefined ? {} : { minItems }),
		...(maxItems === undefined ? {} : { maxItems }),
	});
}

function outputNode(
	source: JsonRecord,
	path: readonly DiagnosticPathSegment[],
	context: NodeContext,
	base: BaseNode,
): FormNode | undefined {
	const definitions = props(source.props, [...path, "props"], context.scopes, context);
	const value = requiredExpression(source.value, [...path, "value"], context);
	const label = optionalString(source.label, [...path, "label"], context);
	const format = outputFormat(source.format, [...path, "format"], context);
	return value
		? Object.freeze({
				...base,
				type: "output",
				value,
				...(label === undefined ? {} : { label }),
				...(format === undefined ? {} : { format }),
				...(definitions ? { props: definitions } : {}),
			})
		: undefined;
}

function outputFormat(
	value: JsonValue | undefined,
	path: readonly DiagnosticPathSegment[],
	context: NodeContext,
): OutputFormat | undefined {
	const format = optionalString(value, path, context);
	if (format === undefined) return undefined;
	if (["plain", "number", "currency-usd", "percent"].includes(format)) return format as OutputFormat;
	diagnostic(context, "unsupported-output-format", path, `Unsupported output format '${format}'.`);
	return undefined;
}

function conditionalNode(
	source: JsonRecord,
	path: readonly DiagnosticPathSegment[],
	context: NodeContext,
	base: BaseNode,
): FormNode | undefined {
	const condition = requiredExpression(source.condition, [...path, "condition"], context);
	const thenNodes = childNodes(source.then, [...path, "then"], context);
	const elseNodes = source.else === undefined ? undefined : childNodes(source.else, [...path, "else"], context);
	if (!condition || !thenNodes || (source.else !== undefined && !elseNodes)) return undefined;
	return Object.freeze({
		...base,
		type: "conditional",
		condition,
		// biome-ignore lint/suspicious/noThenProperty: This is serialized branch data, never a Promise-like value.
		then: thenNodes,
		...(elseNodes ? { else: elseNodes } : {}),
	});
}

function collectionNode(
	type: "tabs" | "accordion",
	source: JsonRecord,
	path: readonly DiagnosticPathSegment[],
	context: NodeContext,
	base: BaseNode,
): FormNode | undefined {
	const key = type === "tabs" ? "tabs" : "items";
	const values = array(source[key], [...path, key], context);
	if (!values) return undefined;
	const entries = values.map((value, index) => collectionEntry(value, [...path, key, index], context));
	if (entries.some((entry) => !entry)) return undefined;
	const complete = Object.freeze(entries.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)));
	return type === "tabs"
		? Object.freeze({ ...base, type, tabs: complete })
		: Object.freeze({ ...base, type, items: complete });
}

function collectionEntry(value: JsonValue, path: readonly DiagnosticPathSegment[], context: NodeContext) {
	const source = record(value, path, context);
	if (!source) return undefined;
	exactKeys(source, new Set(["id", "label", "children"]), path, context);
	const id = identifier(source.id, [...path, "id"], context);
	if (id) registerId(id, [...path, "id"], context);
	const label = optionalString(source.label, [...path, "label"], context);
	if (source.label === undefined) diagnostic(context, "required", [...path, "label"], "Expected a label.");
	const children = childNodes(source.children, [...path, "children"], context);
	return id && label !== undefined && children ? Object.freeze({ id, label, children }) : undefined;
}

function validationNode(
	source: JsonRecord,
	path: readonly DiagnosticPathSegment[],
	context: NodeContext,
	base: BaseNode,
) {
	const target = binding(source.binding, [...path, "binding"], context.scopes, context);
	const values = source.messages === undefined ? undefined : array(source.messages, [...path, "messages"], context);
	const messages = values?.filter((value): value is string => typeof value === "string");
	if (values && messages?.length !== values.length)
		diagnostic(context, "invalid-type", [...path, "messages"], "Expected only string messages.");
	return target
		? Object.freeze({
				...base,
				type: "validation" as const,
				binding: target,
				...(messages ? { messages: Object.freeze(messages) } : {}),
			})
		: undefined;
}

function customNode(source: JsonRecord, path: readonly DiagnosticPathSegment[], context: NodeContext, base: BaseNode) {
	const renderer = identifier(source.renderer, [...path, "renderer"], context);
	const definitions = props(source.props, [...path, "props"], context.scopes, context);
	const children =
		source.children === undefined ? undefined : childNodes(source.children, [...path, "children"], context);
	return renderer
		? Object.freeze({
				...base,
				type: "custom" as const,
				renderer,
				...(definitions ? { props: definitions } : {}),
				...(children ? { children } : {}),
			})
		: undefined;
}

function childNodes(value: JsonValue | undefined, path: readonly DiagnosticPathSegment[], context: NodeContext) {
	const values = array(value, path, context);
	if (!values) return undefined;
	const children = values.map((child, index) => node(child, [...path, index], context));
	return children.some((child) => !child) ? undefined : Object.freeze(children as FormNode[]);
}

function requiredExpression(
	value: JsonValue | undefined,
	path: readonly DiagnosticPathSegment[],
	context: NodeContext,
) {
	return expression(value, path, context.scopes, context)?.expression;
}

function optionalExpression(
	value: JsonValue | undefined,
	path: readonly DiagnosticPathSegment[],
	context: NodeContext,
): Expression | undefined {
	return value === undefined ? undefined : requiredExpression(value, path, context);
}

function registerId(id: string, path: readonly DiagnosticPathSegment[], context: NodeContext): void {
	if (context.nodeIds.has(id)) diagnostic(context, "duplicate-node-id", path, `Duplicate node ID '${id}'.`);
	else context.nodeIds.set(id, path);
}

function nestedContext(
	scope: string,
	target: NonNullable<ReturnType<typeof binding>>,
	path: readonly DiagnosticPathSegment[],
	context: NodeContext,
): NodeContext {
	if (context.scopeIds.has(scope)) {
		diagnostic(context, "duplicate-scope", path, `Duplicate repeater scope '${scope}'.`);
		return context;
	}
	context.scopeIds.set(scope, path);
	return { ...context, scopes: Object.freeze({ ...context.scopes, [scope]: target }) };
}
