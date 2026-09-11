import type { CanonicalPath } from "./path.js";
import type { StandardSchemaLike } from "./standard-schema.js";
import type { FormState, SubmitContext, ValidationIssue } from "./state.js";
import type { TransformDefinition } from "./transforms.js";
import type { ArrayElement, DeepKeys, DeepValue } from "./type-utils.js";

export type EvaluationScope = Record<string, unknown>;
export interface ExprNode {
	type: string;
	[key: string]: unknown;
}
export interface ExpressionDefinition {
	expr: ExprNode;
	scope?: EvaluationScope;
	[key: string]: unknown;
}

/**
 * ADR section 10 — Transform is the config-time type alias.
 * TransformDefinition (from transforms.ts) is the full runtime type with transform().
 * @deprecated Use `TransformDefinition` directly. This alias will be removed in 1.0.
 */
export type Transform = TransformDefinition;

/** Backward-compat alias — prefer EvaluationScope in new code */
export type ExpressionScope = EvaluationScope;
/** Input bag passed to sync validators */
export interface ValidatorInput<TData = unknown, TUi = unknown> {
	readonly data: TData;
	readonly uiState: TUi;
	readonly stage?: string;
	readonly context?: SubmitContext;
}

/** Sync validator — a plain function returning issues */
export type ValidatorFn<TData = unknown, TUi = unknown> = (
	input: ValidatorInput<TData, TUi>,
) => readonly ValidationIssue[];

/** A validator can be a function OR a Standard Schema object (auto-detected and wrapped) */
export type SchemaValidator<TData = unknown, TUi = unknown> = ValidatorFn<TData, TUi> | StandardSchemaLike;

/** Async validator config — function + metadata for scheduling */
export interface AsyncValidatorConfig<TData = unknown, TUi = unknown> {
	/** The validation function. MUST respect signal for cancellation. */
	readonly validate: (input: {
		readonly data: TData;
		readonly uiState: TUi;
		readonly signal: AbortSignal;
	}) => Promise<readonly ValidationIssue[]>;
	/** Dot paths this validator watches. Empty/undefined = form-level. */
	readonly fields?: readonly string[];
	/** Debounce in ms. Default: 300. */
	readonly debounceMs?: number;
	/** Event trigger. Default: 'onChange'. */
	readonly trigger?: "onChange" | "onBlur";
	/** Dedup label. Auto-generated from fields if omitted. */
	readonly label?: string;
}

/** ADR section 9 — Middleware decision for veto-capable hooks */
export type MiddlewareDecision = { readonly action: "continue" } | { readonly action: "veto"; readonly reason: string };

/** Shared middleware context — action + current state snapshot */
export interface ActionStateContext<TData = unknown, TUi = unknown> {
	readonly action: FormAction;
	readonly state: FormState<TData, TUi>;
}

/** Context for beforeAction hook */
export type BeforeActionContext<TData = unknown, TUi = unknown> = ActionStateContext<TData, TUi>;

/** Context for afterAction hook */
export interface AfterActionContext<TData = unknown, TUi = unknown> {
	readonly action: FormAction;
	readonly prevState: FormState<TData, TUi>;
	readonly nextState: FormState<TData, TUi>;
}

/** Context for beforeEvaluate hook */
export type BeforeEvaluateContext<TData = unknown, TUi = unknown> = ActionStateContext<TData, TUi>;

/** Context for afterEvaluate hook */
export type AfterEvaluateContext<TData = unknown, TUi = unknown> = ActionStateContext<TData, TUi>;

/** Context for beforeValidate hook */
export interface BeforeValidateContext<TData = unknown, TUi = unknown> {
	readonly action: FormAction;
	readonly state: FormState<TData, TUi>;
	readonly stage?: string;
}

/** Context for afterValidate hook */
export interface AfterValidateContext<TData = unknown, TUi = unknown> {
	readonly action: FormAction;
	readonly state: FormState<TData, TUi>;
	readonly issues: readonly ValidationIssue[];
}

/** Context for beforeSubmit hook */
export interface BeforeSubmitContext<TData = unknown, TUi = unknown> {
	readonly action: FormAction;
	readonly state: FormState<TData, TUi>;
	readonly submitContext: SubmitContext;
}

/** Context for afterSubmit hook */
export interface AfterSubmitContext<TData = unknown, TUi = unknown> {
	readonly action: FormAction;
	readonly state: FormState<TData, TUi>;
	readonly result: SubmitResult;
}

/** Context for middleware init */
export interface MiddlewareInitContext<TData = unknown, TUi = unknown> {
	readonly state: FormState<TData, TUi>;
}

/** ADR section 9 — Middleware with full lifecycle hooks */
export interface Middleware<TData = unknown, TUi = unknown> {
	readonly id: string;
	onInit?(ctx: MiddlewareInitContext<TData, TUi>): void;
	beforeAction?(ctx: BeforeActionContext<TData, TUi>): MiddlewareDecision | Promise<MiddlewareDecision>;
	afterAction?(ctx: AfterActionContext<TData, TUi>): void;
	beforeEvaluate?(ctx: BeforeEvaluateContext<TData, TUi>): void;
	afterEvaluate?(ctx: AfterEvaluateContext<TData, TUi>): void;
	beforeValidate?(ctx: BeforeValidateContext<TData, TUi>): void;
	afterValidate?(ctx: AfterValidateContext<TData, TUi>): void;
	beforeSubmit?(ctx: BeforeSubmitContext<TData, TUi>): MiddlewareDecision | Promise<MiddlewareDecision>;
	afterSubmit?(ctx: AfterSubmitContext<TData, TUi>): void;
	onDispose?(): void;
}

/** Maps veto-capable hook names to their context types */
export type VetoHookContextMap<TData = unknown, TUi = unknown> = {
	readonly beforeAction: BeforeActionContext<TData, TUi>;
	readonly beforeSubmit: BeforeSubmitContext<TData, TUi>;
};

/** Maps notification hook names to their context types */
export type NotifyHookContextMap<TData = unknown, TUi = unknown> = {
	readonly beforeEvaluate: BeforeEvaluateContext<TData, TUi>;
	readonly afterEvaluate: AfterEvaluateContext<TData, TUi>;
	readonly beforeValidate: BeforeValidateContext<TData, TUi>;
	readonly afterValidate: AfterValidateContext<TData, TUi>;
	readonly afterAction: AfterActionContext<TData, TUi>;
	readonly afterSubmit: AfterSubmitContext<TData, TUi>;
};

/** ADR section 9 — SubmitExecutionContext */
export interface SubmitExecutionContext<TData, TUi> {
	readonly form: FormApi<TData, TUi>;
	readonly submitContext: SubmitContext;
	readonly payload: TData;
}

/** ADR section 9 — SubmitResult */
export interface SubmitResult {
	readonly ok: boolean;
	readonly submitId: string;
	readonly message?: string;
	/** Shorthand: { fieldPath: errorMessage } — auto-converted to ValidationIssue[] */
	readonly fieldErrors?: Readonly<Record<string, string>>;
	readonly fieldIssues?: readonly ValidationIssue[];
	readonly globalIssues?: readonly ValidationIssue[];
}

/** ADR section 9 — FormAction */
export interface FormAction {
	readonly type: string;
	readonly path?: string;
	readonly value?: unknown;
	readonly origin?: string;
}

/** ADR section 9 — FormDispatchResult */
export interface FormDispatchResult {
	readonly ok: boolean;
	readonly error?: string;
}

/** When an issue becomes visible to the user */
export type ValidationTrigger = "onChange" | "onBlur" | "onSubmit" | "onMount";

/** Per-field validation gating config */
export interface FieldValidationTriggers {
	/** Show issues when field value changes (field is dirty). Default trigger. */
	readonly onChange?: boolean;
	/** Show issues when field loses focus (field is touched via markTouched). */
	readonly onBlur?: boolean;
	/** Show issues only after form.submit() is called. */
	readonly onSubmit?: boolean;
	/** Show issues immediately on mount. */
	readonly onMount?: boolean;
	/** Re-show issues when a listed source field's value changes */
	readonly onChangeListenTo?: readonly string[];
	/** Re-show issues when a listed source field is blurred */
	readonly onBlurListenTo?: readonly string[];
}

/** ADR section 9.1 — FieldConfig */
export interface FieldConfig {
	readonly label?: string;
	readonly description?: string;
	readonly placeholder?: string;
	readonly disabled?: boolean;
	readonly readOnly?: boolean;
	readonly required?: boolean;
	readonly hidden?: boolean;
	readonly validators?: readonly ValidatorFn[];
	readonly transforms?: readonly Transform[];
	readonly metadata?: Readonly<Record<string, unknown>>;
	readonly validationTriggers?: FieldValidationTriggers;
}

/** ADR section 9 — FieldApi */
export interface FieldApi<TData, TUi, TPath extends string> {
	readonly path: CanonicalPath;
	get(): DeepValue<TData, TPath>;
	set(value: DeepValue<TData, TPath>): FormDispatchResult;
	validate(): readonly ValidationIssue[];
	issues(): readonly ValidationIssue[];
	ui<T = unknown>(selector: (uiState: TUi) => T): T;
	isTouched(): boolean;
	isDirty(): boolean;
	isValidating(): boolean;
	markTouched(): void;
	/** Plugin-contributed field metadata for this field */
	pluginMeta(): import("./plugin-types.js").PluginFieldMeta | undefined;
	/** Set field value — wraps set(). Ready to bind to onChange. */
	handleChange(value: DeepValue<TData, TPath>): FormDispatchResult;
	/** Mark field as touched — wraps markTouched(). Ready to bind to onBlur. */
	handleBlur(): void;
}

/** Array manipulation helpers — available when field value is an array. */
export interface ArrayFieldHelpers<TValue> {
	pushValue(item: ArrayElement<TValue>): FormDispatchResult;
	removeValue(index: number): FormDispatchResult;
	insertValue(index: number, item: ArrayElement<TValue>): FormDispatchResult;
	moveValue(fromIndex: number, toIndex: number): FormDispatchResult;
	swapValue(indexA: number, indexB: number): FormDispatchResult;
}

/** FieldApi with array helpers when the field value is an array. */
export type FieldApiWithArray<TData, TUi, TPath extends string> = FieldApi<TData, TUi, TPath> &
	(NonNullable<DeepValue<TData, TPath>> extends readonly unknown[]
		? ArrayFieldHelpers<DeepValue<TData, TPath>>
		: unknown);

/** ADR section 9 — FormApi */
export interface FormApi<TData, TUi> {
	getState(): FormState<TData, TUi>;
	dispatch(action: FormAction): FormDispatchResult;
	setValue<P extends string & DeepKeys<TData>>(path: P, value: DeepValue<TData, P>): FormDispatchResult;
	validate(stage?: string): readonly ValidationIssue[];
	submit(context?: Partial<SubmitContext>): Promise<SubmitResult>;
	field<P extends string & DeepKeys<TData>>(path: P, config?: FieldConfig): FieldApiWithArray<TData, TUi, P>;
	/** Get a FieldApi for a dynamic (runtime) path — skips deep keypath validation */
	fieldDynamic(path: string, config?: FieldConfig): FieldApiWithArray<TData, TUi, string>;
	subscribe(listener: (state: FormState<TData, TUi>) => void): () => void;
	/** Reset form to initial or provided state */
	reset(nextInitial?: { readonly data?: TData; readonly uiState?: TUi }): void;
	/** True when no error-severity issues exist and not currently submitting */
	canSubmit(): boolean;
	/** True when form data equals initial data */
	isPristine(): boolean;
	/** True when form data differs from initial data */
	isDirty(): boolean;
	/** True when no error-severity issues exist */
	isValid(): boolean;
	/** True when submission is in progress */
	isSubmitting(): boolean;
	/** True when at least one field has been touched */
	isTouched(): boolean;
	isDisposed(): boolean;
	/** Observe disposal without acquiring a state subscription. */
	onDispose(listener: () => void): () => void;
	/** Bounded, code-only failures contained during disposal callbacks. */
	getDisposalDiagnostics(): readonly import("@formbar/expressions").Diagnostic[];
	dispose(): void;
}
