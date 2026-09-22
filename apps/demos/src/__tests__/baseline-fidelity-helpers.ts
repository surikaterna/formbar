import type { FieldNode, FormDefinition, FormNode, ResponsiveSpan } from "@formbar/declarative";
import type { SchemaDemoFixture, SchemaDemoSource } from "../demos/baseline-contracts";

export interface ObjectSchema {
	readonly type: "object";
	readonly required?: readonly string[];
	readonly properties: Readonly<Record<string, unknown>>;
}

export function onlySource(fixture: SchemaDemoFixture): SchemaDemoSource {
	return fixture.sources[0];
}

export function objectSchema(source: SchemaDemoSource): ObjectSchema {
	return source.schema as unknown as ObjectSchema;
}

export function requiredDefinition(source: SchemaDemoSource): FormDefinition {
	if (!source.definition) throw new Error(`Expected a definition for ${source.key}`);
	return source.definition;
}

export function definitionStructure(definition: FormDefinition) {
	if (definition.root.type !== "group") throw new Error("Expected a root group");
	return {
		version: definition.version,
		id: definition.id,
		root: {
			type: definition.root.type,
			id: definition.root.id,
			...(definition.root.label ? { label: definition.root.label } : {}),
			...summarizeState(definition.root),
		},
		nodes: summarizeChildren(definition.root.id, definition.root.children),
	};
}

export function expectedDefinition(id: string, rootId: string, nodes: readonly object[]) {
	return { version: 1, id, root: { type: "group", id: rootId }, nodes };
}

export function expectedSection(parentId: string, order: number, id: string, title: string, description?: string) {
	return {
		parentId,
		order,
		type: "section",
		id,
		title,
		...(description ? { description } : {}),
	};
}

export function expectedField(
	parentId: string,
	order: number,
	id: string,
	path: string | readonly string[],
	widget: string,
	label: string,
	options: { readonly description?: string; readonly span?: ResponsiveSpan } = {},
) {
	return {
		parentId,
		order,
		type: "field",
		id,
		binding: { namespace: "data", segments: typeof path === "string" ? [path] : path },
		widget,
		label,
		...(options.description ? { props: { description: { mode: "literal", value: options.description } } } : {}),
		...(options.span ? { presentation: { span: options.span } } : {}),
	};
}

function summarizeChildren(parentId: string, children: readonly FormNode[]): readonly object[] {
	return children.flatMap((node, order) => {
		const summary = summarizeNode(parentId, order, node);
		if (node.type !== "group" && node.type !== "section") return [summary];
		return [summary, ...summarizeChildren(node.id, node.children)];
	});
}

function summarizeNode(parentId: string, order: number, node: FormNode) {
	const base = { parentId, order, type: node.type, id: node.id, ...summarizeState(node) };
	if (node.type === "section") {
		return {
			...base,
			...(node.title ? { title: node.title } : {}),
			...(node.description ? { description: node.description } : {}),
		};
	}
	if (node.type === "group") return { ...base, ...(node.label ? { label: node.label } : {}) };
	if (node.type === "field") return summarizeField(base, node);
	throw new Error(`Unexpected authored node type: ${node.type}`);
}

function summarizeField(base: object, field: FieldNode) {
	return {
		...base,
		binding: { namespace: field.binding.namespace, segments: field.binding.segments },
		widget: field.widget,
		...(field.label ? { label: field.label } : {}),
		...(field.required !== undefined ? { required: field.required } : {}),
		...(field.props ? { props: field.props } : {}),
	};
}

function summarizeState(node: FormNode) {
	return {
		...(node.visible !== undefined ? { visible: node.visible } : {}),
		...(node.disabled !== undefined ? { disabled: node.disabled } : {}),
		...(node.readOnly !== undefined ? { readOnly: node.readOnly } : {}),
		...(node.presentation ? { presentation: node.presentation } : {}),
	};
}
