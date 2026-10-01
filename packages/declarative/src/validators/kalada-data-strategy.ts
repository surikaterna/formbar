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

/** Ephemeral cancellation/veto channel. A host must still check its own current grant and commit atomically. */
export interface OperationFenceV1 {
	readonly signal: AbortSignal;
	fresh(): boolean;
	advance(revision: object): boolean;
	complete(): boolean;
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
		| {
				readonly targetKind: "row-value";
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
	readonly operation?: OperationFenceV1;
	readonly contract: "formbar-submission-v1";
	readonly instance: object;
	readonly revision: object;
	readonly data: JsonValue;
}

export type SubmissionResult = {
	readonly status: "submitted" | "missing" | "denied" | "stale" | "conflict" | "unsupported";
};

/** Trusted initialization is a host operation, never a client-side positional array merge. */
export interface SchemaDefaultV1 {
	readonly path: readonly (string | "*")[];
	readonly value: JsonValue;
}

export interface SchemaInitializationV1 {
	readonly contract: "formbar-schema-initialization-v1";
	readonly instance: object;
	readonly revision: object;
	readonly defaults: readonly SchemaDefaultV1[];
	readonly overrides?: JsonValue;
}

export type SchemaInitializationResult =
	| { readonly status: "applied"; readonly revision: object }
	| { readonly status: "denied" | "stale" | "conflict" | "unsupported" };

export interface SchemaValidationIssueV1 {
	readonly path: readonly (string | number)[];
	readonly message: string;
	readonly source: "schema" | "extension";
}

export type SchemaValidatorV1 = (
	data: JsonValue,
	signal: AbortSignal,
) => readonly SchemaValidationIssueV1[] | Promise<readonly SchemaValidationIssueV1[]>;

/** Trusted scoped registrations are bound to admitted field paths, not array positions. */
export interface ScopedValidatorV1 {
	readonly id: string;
	readonly field: string;
	readonly trigger: "onChange" | "onBlur";
	/** Optional host scheduling hint; no client-side timer or default is implied. */
	readonly debounceMs?: number;
	readonly validate: SchemaValidatorV1;
}

/** Host-issued field identity includes lexical row ownership, never a rendered position. */
export interface LifecycleField {
	readonly path: string;
	readonly scope: ReadScope;
}

export interface LifecycleIssues {
	readonly schema: readonly string[];
	readonly extension: readonly string[];
}

export interface LifecycleStatus {
	/** Completed authorized submit attempts, independent of successful submitted history. Legacy hosts default to zero. */
	readonly submitCount?: number;
	readonly dirty: boolean;
	readonly touched: boolean;
	readonly validating: boolean;
	readonly submitted: boolean;
	readonly valid: boolean;
	readonly issues: LifecycleIssues;
}

/** All values, including the initial baseline, belong to the same host revision. */
export interface LifecycleFrame {
	readonly instance: object;
	readonly revision: object;
	readonly form: LifecycleStatus;
	readonly initial: JsonValue;
	field(field: LifecycleField):
		| { readonly status: "found"; readonly value: LifecycleStatus }
		| {
				readonly status: "missing" | "denied" | "stale" | "conflict";
		  };
}

export type LifecycleCapture = LifecycleFrame | { readonly status: "missing" | "denied" | "stale" };

export interface LifecycleRequest {
	/** Host submission validation intent, not a grant; must remain fenced by its owned operation. */
	readonly submissionAttempt?: true;
	readonly operation?: OperationFenceV1;
	readonly contract: "formbar-lifecycle-v1";
	readonly instance: object;
	readonly revision: object;
}

export interface ScopedLifecycleRequest extends LifecycleRequest {
	readonly field: LifecycleField;
	readonly trigger: "onChange" | "onBlur";
}

export type LifecycleResult =
	| { readonly status: "applied"; readonly revision: object }
	| { readonly status: "invalid" | "missing" | "denied" | "stale" | "conflict" | "unsupported" };

/** Data-only observation from one captured strategy frame. The host independently resolves
 * current policy, lexical ownership, visibility and completeness; this is never a grant.
 * Remote hosts must evaluate the same canonical policy server-side or deny omission. */
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

/** Opaque host receipt binds FINAL validation to the exact candidate and source revision. */
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
	/** Applies defaults only to absent draft locations, with overrides taking precedence. Must
	 * allocate row identities/revisions itself and atomically reject stale or revoked requests. */
	initializeSchema?(context: DataContext, request: SchemaInitializationV1): SchemaInitializationResult;
	/** Host installs trusted callbacks, executes on an atomic draft capture, publishes issues only
	 * while grant/revision/signal remain current, and aborts on reset/disposal/revocation. */
	installSchemaValidation?(
		context: DataContext,
		validators: readonly SchemaValidatorV1[],
	): { readonly status: "installed" | "denied" | "unsupported" };
	/** Host owns lexical row membership, touched/visibility, scheduling, cancellation and
	 * issue replacement by validator ID. Change is sent only after a checked applied write;
	 * blur must not mutate the draft. Pending work is fenced on reset/dispose/revocation. */
	installScopedValidation?(
		context: DataContext,
		validators: readonly ScopedValidatorV1[],
	): { readonly status: "installed" | "denied" | "unsupported" };
	notifyScopedValidation?(context: DataContext, request: ScopedLifecycleRequest): LifecycleResult;
	/** Invalidates queued scoped work on host disposal, even when the draft revision is unchanged. */
	cancelScopedValidation?(context: DataContext): void;
	/** Optional V1 parity ports. No adapter to legacy FormApi/Kuery is provided. */
	captureLifecycle?(context: DataContext): LifecycleCapture;
	/** Host fences asynchronous schema and extension issues by revision and current grant. */
	validateLifecycle?(
		context: DataContext,
		request: LifecycleRequest,
		fresh: () => boolean,
	): Promise<LifecycleResult> | LifecycleResult;
	resetLifecycle?(context: DataContext, request: LifecycleRequest): LifecycleResult;
	/** Host rejects forged, stale, missing, duplicate or unowned observations before copying
	 * the unchanged draft. Resolve owned bindings, never client-supplied array positions. */
	captureOmission?(context: DataContext, request: OmissionRequest): OmissionCapture;
	/** Re-run schema and extension checks on outgoing bytes. A host may exempt only an issue
	 * identified by its trusted validator/issue provenance AND exact owned hidden field scope,
	 * present in this revision's draft validation. Paths alone (including equal paths) confer
	 * no exemption. Bind the resulting proof to candidate bytes, revision and current grant. */
	validateOutgoingCandidate?(
		context: DataContext,
		request: OmissionRequest & { readonly candidate: JsonValue },
		fresh: () => boolean,
	): Promise<OutgoingValidation> | OutgoingValidation;
	/** Host consumes a one-use proof tied to exact outgoing bytes, original issue provenance,
	 * instance/revision and current grant; recheck after every async boundary and at commit. */
	submitOmission?(
		context: DataContext,
		request: OmissionRequest & { readonly candidate: JsonValue; readonly proof: object },
		fresh: () => boolean,
	): Promise<SubmissionResult> | SubmissionResult;
}
