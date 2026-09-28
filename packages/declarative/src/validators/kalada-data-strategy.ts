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

export interface DataFrame {
	readonly token: object;
	/** Authorization, row binding and freshness are checked at use time by the strategy. */
	read(reference: StaticReference, scope: ReadScope): DataRead;
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
