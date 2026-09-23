import type { FormState, ValidationIssue } from "@formbar/core";
import type { DiagnosticCode, JsonValue, Observation, Segment, StateRef, WriteResult } from "@formbar/expressions";
import type { AbsoluteBinding } from "./bindings.js";
import type { FormNode } from "./nodes.js";

export type RuntimeFormState<TData = unknown, TUi = unknown> = Readonly<
	Pick<FormState<TData, TUi>, "data" | "uiState">
>;

export interface RuntimeFormStatus {
	readonly valid: boolean;
	readonly validating: boolean;
	readonly submitting: boolean;
	readonly dirty: boolean;
	readonly touched: boolean;
	readonly submitted: boolean;
}

export interface RuntimeScopeInstance {
	readonly scope: string;
	readonly index: number;
}

export interface RuntimeNodeInstance {
	readonly instanceKey: string;
	readonly nodeId: string;
	readonly scopes: readonly RuntimeScopeInstance[];
}

export interface ResolvedNodeState {
	readonly instance: RuntimeNodeInstance;
	readonly type: FormNode["type"];
	readonly visible: boolean;
	readonly disabled: boolean;
	readonly readOnly: boolean;
	readonly branch?: "then" | "else" | "none";
}

export interface ResolvedFieldState extends ResolvedNodeState {
	readonly type: "field";
	readonly binding: AbsoluteBinding;
	readonly value?: JsonValue;
	readonly issues: readonly ValidationIssue[];
	readonly valid: boolean;
	readonly validating: boolean;
	readonly dirty: boolean;
	readonly touched: boolean;
	readonly required: boolean;
	readonly label: string;
}

export type ResolvedOutput =
	| { readonly status: "hidden" }
	| { readonly status: "ready"; readonly value: JsonValue }
	| { readonly status: "error"; readonly code: DiagnosticCode };

export interface ResolvedOutputState extends ResolvedNodeState {
	readonly type: "output";
	readonly output: ResolvedOutput;
}

export type ResolvedActionPayload =
	| { readonly status: "absent" }
	| { readonly status: "ready"; readonly value: JsonValue }
	| { readonly status: "error"; readonly code: DiagnosticCode };

export interface ResolvedActionState extends ResolvedNodeState {
	readonly type: "action";
	readonly action: string;
	readonly concurrency: "drop" | "replace" | "queue";
	readonly payload: ResolvedActionPayload;
	readonly target?: AbsoluteBinding;
	readonly arrayLimits?: ResolvedArrayLimits;
}

export interface ResolvedArrayLimits {
	readonly minItems: number;
	readonly maxItems?: number;
	readonly conflict: boolean;
}

export interface ResolvedRepeaterItem {
	readonly index: number;
	readonly scopes: readonly RuntimeScopeInstance[];
}

export interface ResolvedRepeaterState extends ResolvedNodeState {
	readonly type: "repeater";
	readonly binding?: AbsoluteBinding;
	readonly status: "ready" | "malformed";
	readonly minItems: number;
	readonly maxItems?: number;
	readonly limitsConflict: boolean;
	readonly length: number;
	readonly label: string;
	readonly items: readonly ResolvedRepeaterItem[];
}

export interface ResolvedValidationState extends ResolvedNodeState {
	readonly type: "validation";
	readonly binding: AbsoluteBinding;
}

export type RuntimeResolvedNodeState =
	| ResolvedFieldState
	| ResolvedOutputState
	| ResolvedActionState
	| ResolvedRepeaterState
	| ResolvedValidationState
	| (ResolvedNodeState & {
			readonly type: Exclude<FormNode["type"], "action" | "field" | "output" | "repeater" | "validation">;
	  });

export interface RuntimeFieldBaseline {
	readonly nodeId: string;
	readonly required?: boolean;
	readonly label?: string;
}

export interface RuntimeRepeaterBaseline {
	readonly nodeId: string;
	readonly minItems?: number;
	readonly maxItems?: number;
	readonly label?: string;
}

export type RuntimeDiagnosticCode =
	| "conflicting-repeater-limits"
	| "duplicate-baseline"
	| "expression"
	| "invalid-baseline"
	| "malformed-repeater"
	| "non-boolean";
export type RuntimeExpressionProperty =
	| "condition"
	| "disabled"
	| "payload"
	| "readOnly"
	| "required"
	| "value"
	| "visible";

export interface RuntimeDiagnostic {
	readonly code: RuntimeDiagnosticCode;
	readonly nodeId: string;
	readonly instanceKey: string;
	readonly property: RuntimeExpressionProperty | "baseline" | "binding" | "limits";
	readonly expressionCode?: DiagnosticCode;
}

export interface RuntimeSnapshot extends RuntimeFormState<JsonValue, JsonValue> {
	readonly form: RuntimeFormStatus;
	readonly nodes: readonly RuntimeResolvedNodeState[];
	readonly fields: readonly ResolvedFieldState[];
	readonly repeaters: readonly ResolvedRepeaterState[];
	readonly diagnostics: readonly RuntimeDiagnostic[];
	readonly namespaces?: Readonly<Record<string, JsonValue>>;
}

export interface RuntimePort {
	isDisposed(): boolean;
	getSnapshot(): RuntimeSnapshot;
	getNode(instanceKey: string): RuntimeResolvedNodeState | undefined;
	read(reference: StateRef): JsonValue | undefined;
	write(namespace: string, segments: readonly Segment[], value: JsonValue): WriteResult;
	subscribe(listener: () => void): () => void;
	observeForm(): Observation<RuntimeFormStatus>;
	observeNode(instanceKey: string): Observation<RuntimeResolvedNodeState | undefined>;
	onDispose(listener: () => void): () => void;
	dispose(): void;
}
