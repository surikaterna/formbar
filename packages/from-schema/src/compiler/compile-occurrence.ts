import type { FormNode } from "@formbar/declarative";
import type { DescriptorDocument, DescriptorNode, DescriptorOccurrence } from "../descriptors/contracts.js";
import type { CompilationDiagnostic } from "../diagnostics.js";
import { type BindingContext, binding, childBinding, repeaterItemBinding } from "./bindings.js";
import { canonicalEnum, canonicalEnumPresentation, directOptions, warnUnsafeOptions } from "./direct-options.js";
import { nodeId, scopeId } from "./ids.js";
import { itemSeed } from "./item-seed.js";
import { containerPresentationFor, presentationFor } from "./presentation.js";

export interface CompilationContext {
	readonly document: DescriptorDocument;
	readonly diagnostics: CompilationDiagnostic[];
}

export function compileOccurrence(
	context: CompilationContext,
	occurrenceId: string,
	bindingContext: BindingContext,
): FormNode {
	const occurrence = context.document.occurrences[occurrenceId];
	if (!occurrence) return missingNode(context, occurrenceId, bindingContext);
	const node = context.document.nodes[occurrence.nodeId];
	const stopped = stoppedOccurrence(context, occurrence, node, bindingContext);
	if (stopped) return stopped;
	return compileNode(context, occurrence, node as DescriptorNode, bindingContext);
}

function stoppedOccurrence(
	context: CompilationContext,
	occurrence: DescriptorOccurrence,
	node: DescriptorNode | undefined,
	bindingContext: BindingContext,
): FormNode | undefined {
	if (!node)
		return fallbackNode(context, occurrence, bindingContext, "missing-descriptor", "Descriptor node is missing.");
	if (occurrence.expansion === "cycle")
		return fallbackNode(
			context,
			occurrence,
			bindingContext,
			"cyclic-schema",
			"Recursive occurrence requires runtime policy.",
		);
	if (occurrence.expansion !== "expanded")
		return fallbackNode(
			context,
			occurrence,
			bindingContext,
			"unsupported-schema",
			`Occurrence expansion is ${occurrence.expansion}.`,
		);
	return undefined;
}

function compileNode(
	context: CompilationContext,
	occurrence: DescriptorOccurrence,
	node: DescriptorNode,
	bindingContext: BindingContext,
): FormNode {
	const presentation = presentationFor(node, context.document.source.provider);
	const directChoice = compileDirectChoice(context, occurrence, node, bindingContext, presentation);
	if (directChoice) return directChoice;
	if (presentation.explicitWidget) return fieldNode(context, occurrence, node, bindingContext, presentation);
	if (hasApplicators(node) && node.kind !== "object")
		return fallbackNode(
			context,
			occurrence,
			bindingContext,
			"unsupported-schema",
			"Applicator evidence requires authored presentation.",
		);
	if (node.kind === "object") return compileObject(context, occurrence, node, bindingContext);
	if (node.kind === "array") return compileArray(context, occurrence, node, bindingContext);
	if (node.kind === "tuple") return compileTuple(context, occurrence, bindingContext);
	if (node.kind === "wrapper" || node.kind === "ref") return compileTransparent(context, occurrence, bindingContext);
	if (node.kind === "union" || node.kind === "intersection")
		return fallbackNode(
			context,
			occurrence,
			bindingContext,
			"composed-schema",
			"Composed schema retained without selecting a branch.",
		);
	if (node.kind === "unknown" || node.kind === "opaque")
		return fallbackNode(
			context,
			occurrence,
			bindingContext,
			"opaque-schema",
			`${node.kind} schema evidence cannot select a widget.`,
		);
	if (node.kind === "record" || node.kind === "unconstrained" || node.kind === "never" || unsupportedPrimitive(node))
		return fallbackNode(
			context,
			occurrence,
			bindingContext,
			"unsupported-schema",
			`${node.kind === "primitive" ? node.type : node.kind} schema evidence requires authored presentation.`,
		);
	return fieldNode(context, occurrence, node, bindingContext);
}

function compileDirectChoice(
	context: CompilationContext,
	occurrence: DescriptorOccurrence,
	node: DescriptorNode,
	bindingContext: BindingContext,
	presentation: ReturnType<typeof presentationFor>,
): FormNode | undefined {
	const canonical = canonicalEnum(context.document, occurrence, node);
	const choiceWidget =
		canonical && node.kind === "intersection" && !presentation.explicitWidget ? "select" : presentation.widget;
	if (canonical && (choiceWidget === "select" || choiceWidget === "radio"))
		return fieldNode(
			context,
			occurrence,
			node,
			bindingContext,
			canonicalEnumPresentation(context, occurrence, node, { ...presentation, widget: choiceWidget }, canonical),
		);
	if (presentation.explicitWidget && presentation.widget !== "select")
		return fieldNode(context, occurrence, node, bindingContext, presentation);
	if (
		node.kind === "primitive" &&
		!unsupportedPrimitive(node) &&
		!hasApplicators(node) &&
		!presentation.explicitWidget
	) {
		const options = directOptions(context, occurrence, node);
		if (options)
			return fieldNode(context, occurrence, node, bindingContext, {
				...presentation,
				widget: "select",
				props: { ...options, ...presentation.props },
			});
	}
	return undefined;
}

function compileObject(
	context: CompilationContext,
	occurrence: DescriptorOccurrence,
	node: Extract<DescriptorNode, { kind: "object" }>,
	bindingContext: BindingContext,
): FormNode {
	const propertyChildren = occurrence.children
		.map((id) => context.document.occurrences[id])
		.filter((child): child is DescriptorOccurrence => child?.relation === "property" && typeof child.key === "string");
	const children = propertyChildren.map((child) =>
		compileOccurrence(context, child.id, childBinding(bindingContext, child.key as string)),
	);
	children.push(...unsupportedApplicatorChildren(context, occurrence, bindingContext));
	if (node.additionalProperties || hasApplicators(node))
		addDiagnostic(
			context,
			occurrence,
			"unsupported-schema",
			"Object applicator or dynamic-property evidence was retained but not compiled into controls.",
		);
	const presentation = containerPresentationFor(node, context.document.source.provider);
	if (presentation.title !== undefined || presentation.description !== undefined) {
		return Object.freeze({
			id: nodeId(occurrence.id, "section"),
			type: "section",
			...(presentation.title === undefined ? {} : { title: presentation.title }),
			...(presentation.description === undefined ? {} : { description: presentation.description }),
			children: Object.freeze(children),
		});
	}
	return Object.freeze({ id: nodeId(occurrence.id, "group"), type: "group", children: Object.freeze(children) });
}

function compileArray(
	context: CompilationContext,
	occurrence: DescriptorOccurrence,
	node: Extract<DescriptorNode, { kind: "array" }>,
	bindingContext: BindingContext,
): FormNode {
	const item = occurrence.children
		.map((id) => context.document.occurrences[id])
		.find((child) => child?.relation === "items");
	const scope = scopeId(occurrence.id);
	const child = item
		? compileOccurrence(context, item.id, repeaterItemBinding(scope))
		: fallbackNode(
				context,
				occurrence,
				repeaterItemBinding(scope),
				"missing-descriptor",
				"Array item occurrence is missing.",
			);
	const evidence = context.document.evidence[occurrence.nodeId];
	const presentation = containerPresentationFor(node, context.document.source.provider);
	const target = binding(bindingContext);
	const rowActions: FormNode[] = [
		action(nodeId(occurrence.id, "move-up"), "array.move", "Move up", target, { offset: -1 }),
		action(nodeId(occurrence.id, "move-down"), "array.move", "Move down", target, { offset: 1 }),
		action(nodeId(occurrence.id, "remove"), "array.remove", "Remove", target),
	];
	const repeater: FormNode = Object.freeze({
		id: nodeId(occurrence.id, "repeater"),
		type: "repeater",
		binding: target,
		scope,
		...(presentation.title === undefined ? {} : { label: presentation.title }),
		children: Object.freeze([child, ...rowActions]),
		...(evidence?.minItems === undefined ? {} : { minItems: evidence.minItems }),
		...(evidence?.maxItems === undefined ? {} : { maxItems: evidence.maxItems }),
	});
	const seed = item ? itemSeed(context.document, item.nodeId) : undefined;
	if (seed === undefined) {
		addDiagnostic(context, occurrence, "unsupported-schema", "Array item schema has no safe append seed.");
	}
	const children = [
		repeater,
		...(seed === undefined ? [] : [action(nodeId(occurrence.id, "append"), "array.append", "Add item", target, seed)]),
	];
	return Object.freeze({ id: nodeId(occurrence.id, "array-group"), type: "group", children: Object.freeze(children) });
}

function action(
	id: string,
	actionId: "array.append" | "array.move" | "array.remove",
	label: string,
	target: ReturnType<typeof binding>,
	payload?: Parameters<typeof literalExpression>[0],
): FormNode {
	return Object.freeze({
		id,
		type: "action",
		action: actionId,
		label,
		target,
		...(payload === undefined ? {} : { payload: literalExpression(payload) }),
	});
}

function literalExpression(value: import("@formbar/declarative").JsonValue) {
	return Object.freeze({ kind: "literal" as const, value });
}

function compileTuple(
	context: CompilationContext,
	occurrence: DescriptorOccurrence,
	bindingContext: BindingContext,
): FormNode {
	const children = occurrence.children
		.map((id) => context.document.occurrences[id])
		.filter((child): child is DescriptorOccurrence => child?.relation === "tuple-item" && typeof child.key === "number")
		.map((child) => compileOccurrence(context, child.id, childBinding(bindingContext, child.key as number)));
	const rest = occurrence.children
		.map((id) => context.document.occurrences[id])
		.find((child) => child?.relation === "tuple-rest");
	if (rest)
		children.push(
			fallbackNode(context, rest, bindingContext, "unsupported-schema", "Tuple rest requires authored presentation."),
		);
	addDiagnostic(
		context,
		occurrence,
		"unsupported-schema",
		"Tuple structure compiled positionally; rest evidence remains descriptor-only.",
	);
	return Object.freeze({ id: nodeId(occurrence.id, "group"), type: "group", children: Object.freeze(children) });
}

function compileTransparent(
	context: CompilationContext,
	occurrence: DescriptorOccurrence,
	bindingContext: BindingContext,
): FormNode {
	const child = occurrence.children
		.map((id) => context.document.occurrences[id])
		.find((item) => item?.relation === "wrapper" || item?.relation === "reference");
	return child
		? compileOccurrence(context, child.id, bindingContext)
		: fallbackNode(
				context,
				occurrence,
				bindingContext,
				"unsupported-schema",
				"Unresolved wrapper or reference requires authored presentation.",
			);
}

function fieldNode(
	context: CompilationContext,
	occurrence: DescriptorOccurrence,
	node: DescriptorNode,
	bindingContext: BindingContext,
	compiled?: ReturnType<typeof presentationFor>,
): FormNode {
	const presentation = compiled ?? presentationFor(node, context.document.source.provider);
	warnUnsafeOptions(context, occurrence, node);
	const choices =
		node.kind === "primitive" &&
		!unsupportedPrimitive(node) &&
		!hasApplicators(node) &&
		(presentation.widget === "select" || presentation.widget === "radio") &&
		presentation.props?.options === undefined
			? directOptions(context, occurrence, node)
			: undefined;
	if (presentation.invalidProps)
		addDiagnostic(
			context,
			occurrence,
			"invalid-extension-props",
			"x-formbar.props must contain only safe JSON values.",
		);
	if (presentation.invalidWidget)
		addDiagnostic(context, occurrence, "invalid-extension-id", "x-formbar.widget must be a safe non-empty string ID.");
	const invalidExtension = presentation.invalidProps || presentation.invalidWidget;
	return Object.freeze({
		id: nodeId(occurrence.id, "field"),
		type: "field",
		binding: binding(bindingContext),
		widget: invalidExtension ? "unsupported" : presentation.widget,
		...(presentation.label === undefined ? {} : { label: presentation.label }),
		...(presentation.presentation ? { presentation: presentation.presentation } : {}),
		...(!invalidExtension && (presentation.props || choices) ? { props: { ...presentation.props, ...choices } } : {}),
	});
}

function fallbackNode(
	context: CompilationContext,
	occurrence: DescriptorOccurrence,
	bindingContext: BindingContext,
	code: CompilationDiagnostic["code"],
	message: string,
): FormNode {
	addDiagnostic(context, occurrence, code, message);
	return Object.freeze({
		id: nodeId(occurrence.id, "field"),
		type: "field",
		binding: binding(bindingContext),
		widget: "unsupported",
	});
}

function missingNode(context: CompilationContext, occurrenceId: string, bindingContext: BindingContext): FormNode {
	const occurrence = Object.freeze({ id: occurrenceId, nodeId: "missing" }) as DescriptorOccurrence;
	return fallbackNode(context, occurrence, bindingContext, "missing-descriptor", "Occurrence is missing.");
}

function addDiagnostic(
	context: CompilationContext,
	occurrence: DescriptorOccurrence,
	code: CompilationDiagnostic["code"],
	message: string,
): void {
	context.diagnostics.push({
		code,
		severity: "warning",
		occurrenceId: occurrence.id,
		nodeId: occurrence.nodeId,
		message,
	});
}

function hasApplicators(node: DescriptorNode): boolean {
	const value = node.applicators;
	if (!value) return false;
	if (value.if || value.then || value.else || value.not || value.contains || value.propertyNames) return true;
	return Object.keys(value.patternProperties ?? {}).length > 0 || Object.keys(value.dependentSchemas ?? {}).length > 0;
}

function unsupportedApplicatorChildren(
	context: CompilationContext,
	occurrence: DescriptorOccurrence,
	bindingContext: BindingContext,
): FormNode[] {
	return occurrence.children
		.map((id) => context.document.occurrences[id])
		.filter((child): child is DescriptorOccurrence => child?.relation === "applicator")
		.map((child) =>
			fallbackNode(
				context,
				child,
				bindingContext,
				"unsupported-schema",
				"Applicator branch requires authored presentation.",
			),
		);
}

function unsupportedPrimitive(node: DescriptorNode): boolean {
	if (node.kind !== "primitive") return false;
	return !["string", "number", "integer", "boolean", "date"].includes(node.type);
}
