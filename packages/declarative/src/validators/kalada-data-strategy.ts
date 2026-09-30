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
	/** Filled by the private runtime from the frame that enumerated this row. */
	readonly formRevision?: object;
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

/** Private atomic whole-data capture; host must snapshot data and revision together. */
export type SubmissionCapture =
	| { readonly status: "found"; readonly instance: object; readonly revision: object; readonly data: JsonValue }
	| { readonly status: "missing" | "denied" | "stale" };

export interface SubmissionRequest {
	readonly contract: "formbar-submission-v1";
	readonly instance: object;
	readonly revision: object;
	readonly data: JsonValue;
}

export type SubmissionResult = {
	readonly status: "submitted" | "missing" | "denied" | "stale" | "conflict" | "unsupported";
};

/** Optional trusted-host lifecycle port. Row tokens are lexical identities, never positions. */
export interface LifecycleField {
	readonly path: string;
	readonly scope: ReadScope;
}

export interface LifecycleStatus {
	readonly dirty: boolean;
	readonly touched: boolean;
	readonly validating: boolean;
	readonly submitted: boolean;
	readonly valid: boolean;
	readonly issues: Readonly<{ schema: readonly string[]; extension: readonly string[] }>;
}

export interface LifecycleFrame {
	readonly instance: object;
	readonly revision: object;
	readonly form: LifecycleStatus;
	readonly initial: JsonValue;
	field(
		field: LifecycleField,
	):
		| { readonly status: "found"; readonly value: LifecycleStatus }
		| { readonly status: "missing" | "denied" | "stale" | "conflict" };
}

export interface LifecycleRequest {
	readonly contract: "formbar-lifecycle-v1";
	readonly instance: object;
	readonly revision: object;
}

export type LifecycleResult =
	| { readonly status: "applied"; readonly revision: object }
	| { readonly status: "invalid" | "missing" | "denied" | "stale" | "conflict" | "unsupported" };

/** Observations are not grants. Host MUST independently check current policy, ownership,
 * visibility, issue provenance and complete lexical inventory at every operation. */
export interface OmissionRequest extends LifecycleRequest {
	readonly hiddenValues: "include" | "omit-inactive";
	readonly fields: readonly Readonly<{
		readonly field: LifecycleField;
		readonly visible: boolean;
		readonly submitWhenHidden?: "include";
	}>[];
}

export type OmissionCapture =
	| { readonly status: "found"; readonly instance: object; readonly revision: object; readonly candidate: JsonValue }
	| { readonly status: "missing" | "denied" | "stale" | "conflict" | "unsupported" };

/** Proof is host-issued, one-use, and bound to exact bytes, instance, revision, grant and
 * original issue identities. Only the original owned hidden issue may be exempted. */
export type OutgoingValidation =
	| { readonly status: "applied"; readonly revision: object; readonly proof: object }
	| { readonly status: "invalid" | "missing" | "denied" | "stale" | "conflict" | "unsupported" };

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
	/** Never implemented as read(data, []); the host returns bounded whole-data JSON. */
	captureSubmission?(context: DataContext): SubmissionCapture;
	/** Host checks freshness AND current grant, instance and revision in its commit critical section,
	 * including after async handoff. The ephemeral check is never serialized or an authorization grant. */
	submitCaptured?(
		context: DataContext,
		request: SubmissionRequest,
		fresh: () => boolean,
	): Promise<SubmissionResult> | SubmissionResult;
	/** Atomic host frame: initial baseline and issues must share the returned revision. */
	captureLifecycle?(context: DataContext): LifecycleFrame | { readonly status: "denied" | "missing" | "stale" };
	/** Host fences sync and async issue publication against abort, reset, grant and revision. */
	validateLifecycle?(
		context: DataContext,
		request: LifecycleRequest,
		fresh: () => boolean,
	): Promise<LifecycleResult> | LifecycleResult;
	/** Reset uses host-owned initialized defaults; never reconstruct from rendered fields. */
	resetLifecycle?(context: DataContext, request: LifecycleRequest): LifecycleResult;
	/** Host copies draft, omitting only independently verified owned inactive values. */
	captureOmission?(context: DataContext, request: OmissionRequest): OmissionCapture;
	/** Revalidate FINAL candidate bytes, including independently owned same-path issues. */
	validateOutgoingCandidate?(
		context: DataContext,
		request: OmissionRequest & { readonly candidate: JsonValue },
		fresh: () => boolean,
	): Promise<OutgoingValidation> | OutgoingValidation;
	/** Consume proof once; recheck grant and freshness after every async boundary and at commit. */
	submitOmission?(
		context: DataContext,
		request: OmissionRequest & { readonly candidate: JsonValue; readonly proof: object },
		fresh: () => boolean,
	): Promise<SubmissionResult> | SubmissionResult;
}
