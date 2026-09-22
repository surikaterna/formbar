import type { FormDefinition, FormNode } from "@formbar/declarative";
import type { SchemaDemoFixture } from "./baseline-contracts";

function field(id: string, path: string, widget: string, label?: string, description?: string): FormNode {
	return {
		type: "field",
		id,
		binding: { namespace: "data", segments: [path] },
		widget,
		...(label ? { label } : {}),
		...(description ? { props: { description: { mode: "literal" as const, value: description } } } : {}),
	};
}

function definition(annotated: boolean): FormDefinition {
	return {
		version: 1,
		id: annotated ? "explicit-schema" : "minimal-schema",
		root: {
			type: "group",
			id: "root",
			children: [
				field(
					"f-name",
					"name",
					"text",
					annotated ? "Full Name" : "name",
					annotated ? "Your complete name as it appears on official documents" : undefined,
				),
				field(
					"f-email",
					"email",
					"email",
					annotated ? "Email Address" : "email",
					annotated ? "Primary contact email" : undefined,
				),
				field("f-age", "age", "number", annotated ? "Age" : "age", annotated ? "Your age in years" : undefined),
				field(
					"f-role",
					"role",
					"select",
					annotated ? "User Role" : "role",
					annotated ? "Access level in the system" : undefined,
				),
				field(
					"f-active",
					"active",
					"checkbox",
					annotated ? "Account Active" : "active",
					annotated ? "Enable or disable this account" : undefined,
				),
			],
		},
	};
}

const minimalSchema = {
	type: "object",
	properties: {
		name: { type: "string" },
		email: { type: "string", format: "email" },
		age: { type: "integer" },
		role: { type: "string", enum: ["Admin", "User", "Guest"] },
		active: { type: "boolean" },
	},
} as const;

const explicitSchema = {
	type: "object",
	required: ["name", "email", "role"],
	properties: {
		name: {
			type: "string",
			title: "Full Name",
			description: "Your complete name as it appears on official documents",
			minLength: 2,
			maxLength: 100,
		},
		email: { type: "string", title: "Email Address", format: "email", description: "Primary contact email" },
		age: { type: "integer", title: "Age", minimum: 0, maximum: 150, description: "Your age in years" },
		role: {
			type: "string",
			title: "User Role",
			enum: ["Admin", "User", "Guest"],
			description: "Access level in the system",
		},
		active: { type: "boolean", title: "Account Active", description: "Enable or disable this account" },
	},
} as const;

export const multiSchemaSourcesDemo = {
	id: "multi-schema-sources",
	title: "13. JSON Schema Sources",
	subtitle: "Two JSON Schema detail levels",
	copy: "Choose between two JSON Schema detail levels—minimal and explicit—for the same name, email, age, role, and active fields.",
	category: "sources",
	sources: [
		{
			key: "minimal",
			label: "Minimal JSON Schema",
			schema: minimalSchema,
			definition: definition(false),
			initialData: {},
		},
		{
			key: "explicit",
			label: "Explicit JSON Schema",
			schema: explicitSchema,
			definition: definition(true),
			initialData: {},
		},
	],
} as const satisfies SchemaDemoFixture;
