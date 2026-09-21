import type { FormAction } from "./contracts.js";
import type { FieldPolicyInput } from "./field-policy.js";
import type { ValidationIssue } from "./state.js";

/**
 * Declarative mutation intent produced by a plugin.
 * Applied by the pipeline after all plugins have been evaluated.
 */
export interface PluginWrite {
	readonly path: string;
	readonly value: unknown;
	readonly mode: "set" | "merge" | "delete";
}

/**
 * Describes what changed in this pipeline tick.
 * Plugins can short-circuit evaluate() based on this.
 */
export interface PluginChangeDescriptor {
	readonly path: string | undefined;
	readonly type: string;
	readonly dataChanged: boolean;
	readonly uiChanged: boolean;
}

/**
 * Immutable context given to plugins during evaluate().
 * This is the stable contract surface — plugins depend only on this.
 */
export interface PluginEvaluateContext<TData = unknown, TUi = unknown> {
	readonly action: FormAction;
	readonly data: Readonly<TData>;
	readonly uiState: Readonly<TUi>;
	readonly prevData: Readonly<TData>;
	readonly prevUiState: Readonly<TUi>;
	readonly change: PluginChangeDescriptor;
	readonly issues: readonly ValidationIssue[];
	readonly origin: "user" | `plugin:${string}` | "reset" | "init";
	getValueAtPath(path: string): unknown;
}

/**
 * What a plugin returns from evaluate(). All fields optional.
 */
export interface PluginEvaluateResult {
	readonly writes?: readonly PluginWrite[];
	readonly fieldPolicy?: readonly FieldPolicyInput[];
}

/**
 * Context provided to plugins at init time.
 * Gives controlled access to form for async operations.
 */
export interface PluginInitContext<TData = unknown, TUi = unknown> {
	readonly getState: () => { readonly data: Readonly<TData>; readonly uiState: Readonly<TUi> };
	readonly subscribe: (
		listener: (state: { readonly data: Readonly<TData>; readonly uiState: Readonly<TUi> }) => void,
	) => () => void;
	readonly dispatch: (action: FormAction) => void;
	readonly initialData: Readonly<TData>;
}

/**
 * Context provided to plugins during submit gating.
 */
export interface PluginSubmitContext<TData = unknown, TUi = unknown> {
	readonly data: Readonly<TData>;
	readonly uiState: Readonly<TUi>;
}

/**
 * FormPlugin — a pipeline extension that evaluates inside the transaction.
 *
 * Lifecycle:
 * 1. onInit — called once when form is created. Return a cleanup function.
 * 2. evaluate — synchronous, runs inside each pipeline tick. Returns writes + field policy.
 * 3. beforeSubmit — called synchronously during submit. Return issues to block submission.
 * 4. onReset — called on form.reset().
 * 5. onDispose — called on form.dispose().
 *
 * Loop prevention: evaluate runs exactly once per pipeline tick.
 * Plugin writes are applied in the same transaction — no re-entry.
 */
export interface FormPlugin<TData = unknown, TUi = unknown> {
	readonly id: string;
	// biome-ignore lint/suspicious/noConfusingVoidType: Plugin callbacks intentionally permit ignored return values.
	onInit?(ctx: PluginInitContext<TData, TUi>): void | (() => void);
	// biome-ignore lint/suspicious/noConfusingVoidType: Plugin callbacks intentionally permit ignored return values.
	evaluate?(ctx: PluginEvaluateContext<TData, TUi>): PluginEvaluateResult | void;
	/** Synchronous gate. Runtime thenables are rejected and their eventual values are ignored. */
	// biome-ignore lint/suspicious/noConfusingVoidType: Plugin callbacks intentionally permit ignored return values.
	beforeSubmit?(ctx: PluginSubmitContext<TData, TUi>): readonly ValidationIssue[] | void;
	onReset?(): void;
	onDispose?(): void;
}
