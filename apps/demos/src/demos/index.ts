import type { ComponentType } from "react";
import { CompilationPreviewDemo } from "./01-compilation-preview";

export interface DemoRegistration {
	readonly id: string;
	readonly title: string;
	readonly subtitle: string;
	readonly category: "compilation";
	readonly component: ComponentType;
}

export const demos: readonly DemoRegistration[] = [
	{
		id: "schema-compilation",
		title: "Schema compilation preview",
		subtitle: "Descriptors and validated FormDefinition v1",
		category: "compilation",
		component: CompilationPreviewDemo,
	},
];
