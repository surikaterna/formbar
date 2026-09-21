import type { FormDefinition } from "@formbar/declarative";

export const PLAYGROUND_DOCUMENT_VERSION = 2 as const;
export const SOURCE_LIMIT_BYTES = 200_000;
export const TOTAL_LIMIT_BYTES = 500_000;

export const SOURCE_KEYS = ["schema", "definition", "initialData"] as const;
export type SourceKey = (typeof SOURCE_KEYS)[number];

export interface PlaygroundDocument {
	readonly version: typeof PLAYGROUND_DOCUMENT_VERSION;
	readonly schema: Record<string, unknown>;
	readonly definition: FormDefinition | null;
	readonly initialData: Record<string, unknown>;
}

export type PlaygroundSources = Record<SourceKey, string>;
export type SourceErrors = Partial<Record<SourceKey, string>>;

export interface PlaygroundPreset {
	readonly key: string;
	readonly demoId: string;
	readonly variant: string;
	readonly label: string;
	readonly support: "full";
	readonly warning?: string;
	readonly document: PlaygroundDocument;
}

export interface DemoCompatibility {
	readonly demoId: string;
	readonly support: "full" | "unsupported";
	readonly reason?: string;
	readonly presets: readonly PlaygroundPreset[];
}
