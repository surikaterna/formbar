import type { ArbiterPluginOptions } from "@formbar/arbiter";
import type { FormDefinition } from "@formbar/declarative";

export interface SchemaDemoSource {
	readonly key: string;
	readonly label: string;
	readonly schema: Readonly<Record<string, unknown>>;
	readonly definition?: FormDefinition;
	readonly initialData: Readonly<Record<string, unknown>>;
	/** Immutable JSON-serializable module constant; structural changes replace this reference. */
	readonly arbiterRules?: NonNullable<ArbiterPluginOptions["rules"]>;
}

export interface SchemaDemoFixture {
	readonly id: string;
	readonly title: string;
	readonly subtitle: string;
	readonly copy: string;
	readonly category: "baseline" | "conditional" | "layout" | "sources";
	readonly sources: readonly [SchemaDemoSource, ...SchemaDemoSource[]];
}
