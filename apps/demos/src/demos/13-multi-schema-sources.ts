import type { SchemaDemoFixture } from "./baseline-contracts";

const minimalSchema = {
	type: "object",
	properties: {
		name: { type: "string" },
		email: { type: "string", format: "email" },
		contactMethod: { enum: ["Email", "Phone"] },
	},
	required: ["name", "email"],
} as const;

const annotatedSchema = {
	type: "object",
	title: "Annotated contact",
	description: "Presentation annotations enrich the same domain fields.",
	properties: {
		name: {
			type: "string",
			title: "Full name",
			minLength: 2,
			"x-formbar": { label: "Display name", placeholder: "Ada Lovelace", span: { base: "full", md: 6 } },
		},
		email: {
			type: "string",
			title: "Work email",
			format: "email",
			"x-formbar": { placeholder: "ada@example.com", span: { base: "full", md: 6 } },
		},
		contactMethod: { title: "Preferred contact method", enum: ["Email", "Phone"] },
	},
	required: ["name", "email"],
} as const;

export const multiSchemaSourcesDemo = {
	id: "multi-schema-sources",
	title: "13. JSON Schema sources",
	subtitle: "Two JSON Schema detail levels",
	copy: "Choose between two JSON Schema detail levels. Both compile through the same released host and renderer.",
	category: "sources",
	sources: [
		{
			key: "minimal",
			label: "Minimal JSON Schema",
			schema: minimalSchema,
			initialData: { name: "Minimal name", email: "minimal@example.com", contactMethod: "Email" },
		},
		{
			key: "annotated",
			label: "Annotated JSON Schema",
			schema: annotatedSchema,
			initialData: { name: "Annotated name", email: "annotated@example.com", contactMethod: "Phone" },
		},
	],
} as const satisfies SchemaDemoFixture;
