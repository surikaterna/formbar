import type { ArbiterPluginOptions } from "@formbar/arbiter";
import type { FormDefinition } from "@formbar/declarative";
import type { RendererExtensions } from "@formbar/react-schema";

export interface SchemaDemoRuntimeProfile {
	readonly id: string;
	readonly extensions: RendererExtensions;
}

export interface SchemaDemoDefinitionVariant {
	readonly key: string;
	readonly label: string;
	readonly definition: FormDefinition;
}

interface SchemaDemoSourceBase {
	readonly key: string;
	readonly label: string;
	readonly schema: Readonly<Record<string, unknown>>;
	readonly initialData: Readonly<Record<string, unknown>>;
	/** Immutable JSON-serializable module constant; structural changes replace this reference. */
	readonly arbiterRules?: NonNullable<ArbiterPluginOptions["rules"]>;
}

export type SchemaDemoSource = SchemaDemoSourceBase &
	(
		| { readonly definition?: FormDefinition; readonly definitionVariants?: never }
		| {
				readonly definition?: never;
				readonly definitionVariants: readonly [SchemaDemoDefinitionVariant, ...SchemaDemoDefinitionVariant[]];
		  }
	);

export interface SchemaDemoFixture {
	readonly id: string;
	readonly title: string;
	readonly subtitle: string;
	readonly copy: string;
	readonly category: "baseline" | "conditional" | "layout" | "sources";
	readonly sources: readonly [SchemaDemoSource, ...SchemaDemoSource[]];
	readonly runtimeProfile?: SchemaDemoRuntimeProfile;
}
