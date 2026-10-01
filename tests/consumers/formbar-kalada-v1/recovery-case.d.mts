import type { KaladaV1Host } from "@formbar/declarative";
export function fixture(
	type: "field" | "custom",
	options?: { binding?: string; renderer?: string; fail?: boolean; value?: string },
): { host: KaladaV1Host; dispose(): void; write(name: string, value: string | boolean): void };
export function runRecovery(type: "field" | "custom"): Promise<void>;
export function runRecoveryHydration(type: "field" | "custom"): Promise<void>;
