import type { FormApi } from "@formbar/core";
import type { JsonValue, Observation } from "@formbar/expressions";
import type { RuntimePort, RuntimeSnapshot } from "./runtime-contracts.js";

export type BuiltInActionId =
	| "submit"
	| "reset"
	| "validate"
	| "array.append"
	| "array.insert"
	| "array.remove"
	| "array.move"
	| "array.swap";

export type ActionDiagnosticCode =
	| "invalid-registration"
	| "reserved-action-registration"
	| "duplicate-action-registration"
	| "unknown-action"
	| "action-unavailable"
	| "invalid-action-payload"
	| "invalid-action-target"
	| "action-failed"
	| "action-aborted";

export interface ActionDiagnostic {
	readonly code: ActionDiagnosticCode;
	readonly action?: string;
	readonly nodeId?: string;
	readonly instanceKey?: string;
}

export interface ActionRegistration {
	readonly id: string;
	readonly handler: ActionHandler;
}

export interface ActionRequest {
	readonly action: string;
	readonly nodeId: string;
	readonly instanceKey: string;
	readonly payload?: JsonValue;
}

export interface ActionHandlerContext {
	readonly runtime: RuntimePort;
	readonly snapshot: RuntimeSnapshot;
	readonly signal: AbortSignal;
}

export type ActionHandler = (request: ActionRequest, context: ActionHandlerContext) => void | Promise<void>;

export type ActionExecutionStatus = "idle" | "pending" | "succeeded" | "failed";

export interface ActionExecutionState {
	readonly status: ActionExecutionStatus;
	/** Current static/runtime reason the action cannot start. */
	readonly availability?: ActionDiagnosticCode;
	/** Diagnostic from the most recent started execution. */
	readonly diagnostic?: ActionDiagnosticCode;
}

export type ActionExecutionResult =
	| { readonly status: "completed" }
	| { readonly status: "dropped" }
	| { readonly status: "aborted"; readonly diagnostic: "action-aborted" }
	| { readonly status: "failed"; readonly diagnostic: ActionDiagnosticCode };

export interface ActionExecutor {
	getDiagnostics(): readonly ActionDiagnostic[];
	observe(instanceKey: string): Observation<ActionExecutionState>;
	execute(instanceKey: string): Promise<ActionExecutionResult>;
	isDisposed(): boolean;
	dispose(): void;
}

export interface CreateActionExecutorOptions<TData = unknown, TUi = unknown> {
	readonly form: FormApi<TData, TUi>;
	readonly runtime: RuntimePort;
	readonly actions?: readonly ActionRegistration[];
}
