import type { FieldPolicyContribution } from "./field-policy.js";
import type { CanonicalPath } from "./path.js";

/** ADR section 6.2 */
export type IssueSeverity = "error" | "warning" | "info";

/** ADR section 6.2 — ValidationIssue */
export interface ValidationIssue {
	readonly code: string;
	readonly message: string;
	readonly severity: IssueSeverity;
	readonly stage?: string;
	readonly path: CanonicalPath;
	readonly source: {
		readonly origin:
			| "standard-schema"
			| "function-validator"
			| "json-schema-adapter"
			| "rule"
			| "middleware"
			| "async-validator"
			| "submit";
		readonly validatorId: string;
		readonly adapterId?: string;
		readonly ruleId?: string;
	};
	readonly details?: Readonly<Record<string, unknown>>;
}

/** ADR section 2.1 — SubmitContext */
export interface SubmitContext {
	readonly actorId?: string;
	readonly requestId: string;
	readonly at: string; // ISO-8601 UTC
	readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Per-field engine metadata — NOT in $ui, this is form engine state */
export interface FieldMetaEntry {
	readonly touched: boolean;
	readonly isValidating: boolean;
	readonly dirty: boolean;
	/** True when a listened-to field changed, making issues visible */
	readonly listenerTriggered: boolean;
}

/** Candidate validation for one submit attempt; never replaces retained draft issues. */
export interface AttemptValidation {
	readonly submitId: string;
	readonly revision: number;
	readonly status: "running" | "failed" | "succeeded";
	readonly issues: readonly ValidationIssue[];
	/** Store-derived projection for stable snapshot reads; includes retained issues. */
	readonly renderableIssues: readonly ValidationIssue[];
}

/** ADR section 1.1 — FormState */
export interface FormState<TData, TUi> {
	readonly data: TData;
	readonly uiState: TUi;
	readonly meta: {
		readonly stage?: string;
		readonly submitted?: boolean;
		readonly validation: {
			readonly lastValidatedAt?: string; // ISO-8601 UTC
			readonly validating?: boolean;
		};
		readonly submission?: {
			readonly status: "idle" | "running" | "succeeded" | "failed";
			readonly submitId?: string;
			readonly lastAttemptAt?: string; // ISO-8601 UTC
			readonly lastResultAt?: string; // ISO-8601 UTC
			readonly lastErrorCode?: string;
		};
	};
	readonly fieldMeta: Readonly<Record<string, FieldMetaEntry>>;
	readonly fieldPolicy: readonly FieldPolicyContribution[];
	readonly issues: readonly ValidationIssue[];
	/** Present only when an isolated candidate attempt has been started. */
	readonly attemptValidation?: AttemptValidation;
}

/** One coherent current-state capture with private-baseline lifecycle queries. */
export interface FormStateCapture<TData, TUi> {
	readonly state: FormState<TData, TUi>;
	/** Compare captured data with the privately retained data baseline. */
	isFormDirty(): boolean;
	/** Compare a captured data or UI field with its privately retained baseline. */
	isFieldDirty(path: CanonicalPath): boolean;
}

/** ADR section 9 — CreateFormOptions */
export interface CreateFormOptions<TData, TUi> {
	readonly schema?: unknown;
	readonly uiStateSchema?: unknown;
	readonly initialData?: TData;
	readonly initialUiState?: TUi;
	readonly validators?: readonly SchemaValidator<TData, TUi>[];
	readonly middleware?: readonly Middleware<TData, TUi>[];
	readonly transforms?: readonly TransformDefinition<TData>[];
	readonly plugins?: readonly FormPlugin<TData, TUi>[];
	/** Form-level field defaults — merged below field-level overrides (tier 2 of 3) */
	readonly fieldDefaults?: Readonly<FieldConfig>;
	readonly onSubmit?: (ctx: SubmitExecutionContext<TData, TUi>) => Promise<SubmitResult>;
	readonly timeouts?: {
		readonly validator?: number;
		readonly middleware?: number;
		readonly submit?: number;
	};
	readonly stateStrategy?: StateStrategy;
	/** Injectable clock for deterministic testing. Defaults to `() => new Date().toISOString()`. */
	readonly clock?: () => string;
	/** Injectable ID generator for deterministic testing. Defaults to Date.now + Math.random. */
	readonly idGenerator?: () => string;
	readonly asyncValidators?: readonly AsyncValidatorConfig<TData, TUi>[];
}

// Imports for CreateFormOptions references
import type {
	AsyncValidatorConfig,
	FieldConfig,
	Middleware,
	SchemaValidator,
	SubmitExecutionContext,
	SubmitResult,
} from "./contracts.js";
import type { FormPlugin } from "./plugin-types.js";
import type { StateStrategy } from "./transaction.js";
import type { TransformDefinition } from "./transforms.js";
