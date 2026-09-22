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

export interface RuntimeFieldBaseline {
	readonly nodeId: string;
	readonly required?: boolean;
	readonly label?: string;
}

export type RuntimeDiagnosticCode = "duplicate-baseline" | "expression" | "invalid-baseline" | "non-boolean";
export type RuntimeExpressionProperty = "condition" | "disabled" | "readOnly" | "required" | "visible";

export interface RuntimeDiagnostic {
	readonly code: RuntimeDiagnosticCode;
	readonly nodeId: string;
	readonly instanceKey: string;
	readonly property: RuntimeExpressionProperty | "baseline";
	readonly expressionCode?: DiagnosticCode;
}

export interface RuntimeSnapshot extends RuntimeFormState<JsonValue, JsonValue> {
	readonly form: RuntimeFormStatus;
	readonly nodes: readonly ResolvedNodeState[];
	readonly fields: readonly ResolvedFieldState[];
	readonly diagnostics: readonly RuntimeDiagnostic[];
	readonly namespaces?: Readonly<Record<string, JsonValue>>;
}

export interface RuntimePort {
	getSnapshot(): RuntimeSnapshot;
	read(reference: StateRef): JsonValue | undefined;
	write(namespace: string, segments: readonly Segment[], value: JsonValue): WriteResult;
	subscribe(listener: () => void): () => void;
	observeForm(): Observation<RuntimeFormStatus>;
	observeNode(instanceKey: string): Observation<ResolvedNodeState | undefined>;
	dispose(): void;
}
