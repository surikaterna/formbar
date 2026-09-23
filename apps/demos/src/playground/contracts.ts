import type { FormDefinition } from "@formbar/declarative";
import type { SchemaDemoSource, TrustedRuntimeProfileId } from "../demos/baseline-contracts";

export const PLAYGROUND_DOCUMENT_VERSION = 2 as const;
export const SOURCE_LIMIT_BYTES = 200_000;
export const TOTAL_LIMIT_BYTES = 500_000;

export const SOURCE_KEYS = ["schema", "definition", "initialData"] as const;
export type SourceKey = (typeof SOURCE_KEYS)[number];

export interface PlaygroundDocument {
	readonly version: typeof PLAYGROUND_DOCUMENT_VERSION;
	readonly schema: Record<string, unknown>;
	readonly definition: FormDefinition;
	readonly initialData: Record<string, unknown>;
}

export type PlaygroundSources = Record<SourceKey, string>;
export type SourceErrors = Partial<Record<SourceKey, string>>;

export type RuntimeCapabilityDeclaration =
	| { readonly kind: "validator"; readonly id: "draft-2020-12" }
	| { readonly kind: "arbiter"; readonly id: "formbar.arbiter" }
	| { readonly kind: "action"; readonly id: string }
	| { readonly kind: "widget"; readonly id: string }
	| { readonly kind: "custom-node"; readonly id: string }
	| { readonly kind: "repeater"; readonly id: "formbar.repeater" }
	| { readonly kind: "output"; readonly id: "formbar.output" }
	| { readonly kind: "action-controls"; readonly id: "host" | "definition" };

export type RuntimeFixedField = "profileIds" | "capabilities" | "initialUiState" | "arbiterRules" | "actionControls";

export interface PlaygroundExample {
	readonly key: string;
	readonly demoId: string;
	readonly number?: number;
	readonly sourceKey: string;
	readonly definitionKey?: string;
	readonly display: {
		readonly demoTitle: string;
		readonly sourceLabel: string;
		readonly definitionLabel?: string;
	};
	readonly document: PlaygroundDocument;
	readonly runtime: {
		readonly profileIds: readonly TrustedRuntimeProfileId[];
		readonly capabilities: readonly RuntimeCapabilityDeclaration[];
		readonly initialUiState: Readonly<Record<string, unknown>>;
		readonly arbiterRules?: SchemaDemoSource["arbiterRules"];
		readonly actionControls: "host" | "definition";
		readonly editable: readonly ["schema", "definition", "initialData"];
		readonly fixed: readonly RuntimeFixedField[];
	};
}

export interface DemoCompatibility {
	readonly demoId: string;
	readonly support: "full" | "unsupported";
	readonly reason?: string;
	readonly presets: readonly { readonly variant: string }[];
}
