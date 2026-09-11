export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type Segment = string | number;
export interface StateRef {
	readonly namespace: string;
	readonly segments: readonly Segment[];
	readonly scope?: string;
}
export type Expression =
	| { readonly kind: "literal"; readonly value: JsonValue }
	| { readonly kind: "ref"; readonly ref: StateRef }
	| { readonly kind: "op"; readonly op: string; readonly args: readonly Expression[] };
export type DiagnosticCode =
	| "invalid-input"
	| "limit"
	| "unsupported-operator"
	| "arity"
	| "type"
	| "non-finite"
	| "division-zero"
	| "backend"
	| "missing"
	| "denied"
	| "disposed"
	| "stale"
	| "read-only"
	| "unknown-program"
	| "adapter";
export interface Diagnostic {
	readonly code: DiagnosticCode;
}
export type Result<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };
export interface BackendProgram {
	evaluate(read: (ref: StateRef) => JsonValue): unknown;
}
export interface ExpressionBackend {
	readonly id: string;
	compile(expression: Expression): Result<BackendProgram>;
}
export interface Program {
	readonly expression: Expression;
	readonly dependencies: readonly StateRef[];
}
export type WriteResult = {
	readonly ok: boolean;
	readonly error?: string;
	readonly diagnostics?: readonly Diagnostic[];
};
export type Setter = (value: JsonValue) => WriteResult;
export interface NamespaceProvider {
	/** Immutable snapshot; own data properties only. No getters or executable values. */
	getSnapshot(): unknown;
	subscribe(listener: () => void): () => void;
	write?(segments: readonly Segment[], value: JsonValue): WriteResult;
	/** Capability/target generation, not a value-change counter. */
	getVersion?(): unknown;
	isDisposed?(): boolean;
}
export type Authorization = (ref: StateRef, operation: "read" | "write") => boolean;
export type Scopes = Readonly<Record<string, StateRef>>;
export interface ServiceOptions {
	readonly backend: ExpressionBackend;
	readonly namespaces?: Readonly<Record<string, NamespaceProvider>>;
	readonly scopes?: Scopes;
	readonly authorize?: Authorization;
}
export interface Observation<T> {
	getSnapshot(): T;
	getLifecycleDiagnostics(): readonly Diagnostic[];
	subscribe(listener: () => void): () => void;
	dispose(): void;
}
export type PropSpec<T extends JsonValue = JsonValue> =
	| { readonly mode: "literal"; readonly value: T }
	| { readonly mode: "read"; readonly expression: Expression }
	| { readonly mode: "write"; readonly expression: Extract<Expression, { kind: "ref" }> };
export type PropDefinitions = Readonly<Record<string, PropSpec>>;
export interface ResolvedProps {
	readonly values: Readonly<Record<string, JsonValue | undefined>>;
	readonly setters: Readonly<Record<string, Setter>>;
	readonly diagnostics: Readonly<Record<string, readonly Diagnostic[]>>;
}
