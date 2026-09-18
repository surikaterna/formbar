export type PlaygroundMode = "web" | "tui" | "both";

export interface ResourceMetric {
	readonly acquired: number;
	readonly disposed: number;
	readonly active: number;
}

export interface SpikeSnapshot {
	readonly mounted: boolean;
	readonly mode: PlaygroundMode;
	readonly formIdentity: number;
	readonly columns: number;
	readonly rows: number;
	readonly finalState: Record<string, unknown>;
	readonly submissions: number;
	readonly textListeners: number;
	readonly resources: { readonly forms: ResourceMetric; readonly terminals: ResourceMetric };
	readonly output: string;
	readonly layoutSignature: string;
	readonly yogaOutput: boolean;
}

export interface SpikeApi {
	snapshot(): SpikeSnapshot;
	resize(width: number, height: number): void;
	setMode(mode: PlaygroundMode): void;
	setValue(path: string, value: unknown): void;
}

declare global {
	interface Window {
		__formbarTuiSpike: SpikeApi;
	}
}
