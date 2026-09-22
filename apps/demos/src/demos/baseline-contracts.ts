import type { FormDefinition } from "@formbar/declarative";

export interface SchemaDemoSource {
	readonly key: string;
	readonly label: string;
	readonly schema: Readonly<Record<string, unknown>>;
	readonly definition?: FormDefinition;
	readonly initialData: Readonly<Record<string, unknown>>;
}

export interface SchemaDemoFixture {
	readonly id: string;
	readonly title: string;
	readonly subtitle: string;
	readonly copy: string;
	readonly category: "baseline" | "layout" | "sources";
	readonly sources: readonly [SchemaDemoSource, ...SchemaDemoSource[]];
}
