import type { JsonValue } from "@formbar/expressions";
import type { StaticReference } from "./static-references.js";

/** Private, trusted-host installation contract. Tokens are opaque and compared by identity. */
export interface DataContext {
	readonly instance: object;
	readonly policyGeneration: string;
	readonly policyFingerprint: string;
}

export interface ReadScope {
	/** Ordered outer-to-inner lexical row bindings; never an array index. */
	readonly rows: readonly Readonly<{ name: string; token: object }>[];
}

export type DataRead =
	| { readonly status: "found"; readonly value: JsonValue }
	| { readonly status: "missing" | "denied" | "stale" };

export interface EnumeratedRow {
	readonly token: object;
	readonly order: number;
	readonly scope: ReadScope;
}

export type RowEnumeration =
	| { readonly status: "found"; readonly rows: readonly EnumeratedRow[] }
	| { readonly status: "missing" | "denied" | "stale" | "capacity" };

export interface DataFrame {
	readonly token: object;
	/** Required for row enumeration: exact form instance that captured this frame. */
	readonly instance?: object;
	/** Authorization, row binding and freshness are checked at use time by the strategy. */
	read(reference: StaticReference, scope: ReadScope): DataRead;
	/** Host owns stable logical identity, lifetime and authorization; never derive tokens from positions. */
	enumerateRows?(parent: ReadScope, binding: StaticReference, childScopeName: string, capacity: number): RowEnumeration;
}

export interface DirectWriteRequest {
	readonly reference: StaticReference;
	readonly scope: ReadScope;
	readonly expectedToken: object;
	readonly value: JsonValue;
}

export interface FormbarDataStrategyV1 {
	readonly contract: "formbar-data-strategy-v1";
	identity(context: DataContext): Readonly<{
		artifact: string;
		policyGeneration: string;
		policyFingerprint: string;
	}>;
	capture(context: DataContext): DataFrame;
	current(context: DataContext): object;
	subscribe(context: DataContext, invalidate: () => void): () => void;
	/** Reserved for #291/#195; #304 never calls this optional port. Atomic authority + target + mutation required. */
	writeDirect?(context: DataContext, request: DirectWriteRequest): { readonly status: "written" | "denied" | "stale" };
}
