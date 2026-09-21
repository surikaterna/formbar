import { CompilationPreview } from "../renderers/CompilationPreview";

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
