import type { ArbiterPluginOptions } from "@formbar/arbiter";
import type { FormDefinition } from "@formbar/declarative";

export const TRUSTED_RUNTIME_PROFILE_IDS = [
	"formbar.standard.v1",
	"formbar.arbiter.v1",
	"demo11.search-actions.v1",
	"demo16.trusted-widgets.v1",
	"demo17.advanced-layout.v1",
	"demo19.numeric-presentation.v1",
] as const;

export type TrustedRuntimeProfileId = (typeof TRUSTED_RUNTIME_PROFILE_IDS)[number];

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
	readonly description?: string;
	readonly initialUiState?: Readonly<Record<string, unknown>>;
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
	readonly category: "baseline" | "conditional" | "layout" | "sources" | "compilation";
	readonly actionControls?: "host" | "definition";
	readonly sources: readonly [SchemaDemoSource, ...SchemaDemoSource[]];
	readonly runtimeProfileIds?: readonly TrustedRuntimeProfileId[];
}
