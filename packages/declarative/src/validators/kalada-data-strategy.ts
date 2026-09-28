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
	/** Optional on read-only hosts; required for a direct write. Host-issued, not an authority grant. */
	readonly writeRevision?: object;
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
	readonly contract: "formbar-direct-write-v1";
	readonly reference: StaticReference;
	readonly scope: ReadScope;
	readonly expectedInstance: object;
	readonly expectedRevision: object;
	readonly expectedRowRevision: object;
	readonly value: JsonValue;
}

export type DirectWriteResult = {
	readonly status: "applied" | "denied" | "missing" | "stale" | "conflict" | "invalid-target" | "unsupported";
};

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
	/** Private only. Resolve every lexical row by identity, permissions, type, readOnly and both revisions
	 * in the SAME serialized transaction as mutation. Missing/duplicate ids fail closed; removal retires ids.
	 * Never resolve to cached numeric positions. A token is not an authorization grant. */
	writeDirect?(context: DataContext, request: DirectWriteRequest): DirectWriteResult;
}
