import type { JsonValue } from "@formbar/expressions";
import type { DataContext, OperationFenceV1, ReadScope } from "./kalada-data-strategy.js";
import type { StaticReference } from "./static-references.js";

export type ArrayOperation407 = "array.append" | "array.insert" | "array.remove" | "array.move" | "array.swap";
export type ActionStatus407 =
	| "applied"
	| "submitted"
	| "dropped"
	| "replaced"
	| "queue-full"
	| "denied"
	| "missing"
	| "stale"
	| "conflict"
	| "invalid"
	| "unsupported"
	| "error";
export interface ActionResult407 {
	readonly status: ActionStatus407;
	readonly path: string;
	/** Presentation receipt for an atomic structural commit, not a writer grant. */
	readonly mutation?: { readonly revision: object };
}

/** Identity is host-issued. A row token is never a position or a serialized payload. */
export interface ArrayRequest407 {
	readonly contract: "formbar-array-action-v1";
	readonly operation: ArrayOperation407;
	readonly target: StaticReference;
	readonly instance: object;
	readonly revision: object;
	readonly scope: ReadScope;
	readonly row?: { readonly token: object; readonly revision: object };
	readonly destination?: { readonly token: object; readonly revision: object };
	readonly payload?: JsonValue;
	readonly minItems?: number;
	readonly maxItems?: number;
	readonly operationFence?: OperationFenceV1;
}

/** Private host extension. Implementations MUST recheck current grant, row identity/revision,
 * target array, bounds and form revision atomically with the mutation. Move/swap destinations
 * are host-issued identities; never interpret payload as a position or use rendered order. */
export interface ArrayActionHost407 {
	mutateArray(context: DataContext, request: ArrayRequest407): { readonly status: ActionStatus407 };
}

/** Registered by trusted application code, never provided in a definition or serialized props.
 * Async handlers must fence every effect/commit with fresh() and signal, including after awaits. */
export type TrustedAction407 = (
	request: Readonly<{
		path: string;
		instance: object;
		revision: object;
		payload?: JsonValue;
		signal: AbortSignal;
		fresh: () => boolean;
		validate?: () => Promise<{ readonly ok: boolean; readonly code?: string }>;
	}>,
) => Promise<{ readonly status: ActionStatus407 }> | { readonly status: ActionStatus407 };
