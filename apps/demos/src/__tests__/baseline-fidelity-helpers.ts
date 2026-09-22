import type { FieldNode, FormDefinition, SectionNode } from "@formbar/declarative";
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

export function definitionSummary(definition: FormDefinition) {
	if (definition.root.type !== "group") throw new Error("Expected a root group");
	return definition.root.children.map((node) => {
		if (node.type !== "section") throw new Error("Expected root sections");
		return sectionSummary(node);
	});
}

export function definitionFields(definition: FormDefinition) {
	if (definition.root.type !== "group") throw new Error("Expected a root group");
	return definition.root.children.map((node) => fieldSummary(node as FieldNode));
}

function sectionSummary(section: SectionNode) {
	return {
		id: section.id,
		title: section.title,
		fields: section.children.map((node) => fieldSummary(node as FieldNode)),
	};
}

function fieldSummary(field: FieldNode) {
	return {
		id: field.id,
		path: field.binding.segments.join("."),
		widget: field.widget,
		label: field.label,
		span: field.presentation?.span,
	};
}
