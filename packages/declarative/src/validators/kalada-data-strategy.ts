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

interface DirectWriteBase {
	readonly contract: "formbar-direct-write-v1";
	readonly reference: StaticReference;
	readonly expectedInstance: object;
	/** Host-owned current revision of this exact form instance, not a row or position. */
	readonly expectedRevision: object;
	readonly value: JsonValue;
}

export type DirectWriteRequest = DirectWriteBase &
	(
		| {
				readonly targetKind: "non-repeater";
				readonly scope: ReadScope & { readonly rows: readonly [] };
				readonly expectedRowRevision?: never;
		  }
		| {
				readonly targetKind: "row";
				readonly scope: ReadScope;
				readonly expectedRowRevision: object;
		  }
	);

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
	/** Private only. Atomically check instance, current grant, readOnly, type, target and form revision
	 * with mutation. Row targets also require stable lexical identities and row revision (#185).
	 * No token or captured revision is an authorization grant; never resolve rows by position. */
	writeDirect?(context: DataContext, request: DirectWriteRequest): DirectWriteResult;
}
