import type { AsyncValidatorConfig } from "./contracts.js";
import type { DataPathInput } from "./field-policy.js";
import type { ScopedForeground } from "./scoped-async-scheduler.js";
import type { FormState, FormStateCapture, SubmitContext, ValidationIssue } from "./state.js";

export interface CoordinatorDeps<TData, TUi> {
	readonly validators: readonly AsyncValidatorConfig<TData, TUi>[];
	readonly validatorTimeout?: number;
	readonly getState: () => FormState<TData, TUi>;
	readonly updateState: (updater: (state: FormState<TData, TUi>) => FormState<TData, TUi>) => void;
	readonly publishValidationStatus?: (paths: ReadonlySet<string>, validating: boolean) => void;
	readonly replaceAsyncIssues?: (ids: ReadonlySet<string>, issues: readonly ValidationIssue[]) => void;
	readonly hasScopedAsync?: () => boolean;
	readonly prepareScopedForeground?: (
		scope: DataPathInput | undefined,
		signal: AbortSignal,
		snapshot: { readonly data: TData; readonly uiState: TUi },
	) => ScopedForeground | undefined;
	readonly publishScopedForeground?: (
		legacyIds: ReadonlySet<string>,
		previous: ReadonlySet<ValidationIssue>,
		issues: readonly ValidationIssue[],
	) => void;
	readonly runScopedCandidate?: (
		snapshot: { readonly data: TData; readonly uiState: TUi },
		signal: AbortSignal,
		revision: number,
		options?: {
			readonly stage?: string;
			readonly context?: SubmitContext;
			readonly capture?: FormStateCapture<TData, TUi>;
		},
	) => Promise<readonly ValidationIssue[]>;
}
