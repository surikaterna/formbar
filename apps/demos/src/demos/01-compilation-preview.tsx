import { CompilationPreview } from "../renderers/CompilationPreview";
import type { SchemaDemoFixture } from "./baseline-contracts";

export const compilationPreviewSchema = {
	type: "object",
	title: "Contact",
	properties: {
		name: { type: "string", title: "Name", minLength: 1 },
		email: { type: "string", title: "Email", format: "email" },
		tags: { type: "array", items: { type: "string", title: "Tag" } },
	},
	required: ["name", "email"],
} as const;

export function CompilationPreviewDemo() {
	return <CompilationPreview schema={compilationPreviewSchema} initialData={{ name: "", email: "", tags: [] }} />;
}

export const compilationPreviewFixture = {
	id: "schema-compilation",
	title: "Compilation preview",
	subtitle: "Descriptors and validated FormDefinition v1",
	copy: "Inspect the schema preparation artifacts and run the resulting production form.",
	category: "compilation",
	sources: [
		{
			key: "default",
			label: "Compilation schema",
			schema: compilationPreviewSchema,
			initialData: { name: "", email: "", tags: [] },
		},
	],
} as const satisfies SchemaDemoFixture;
