import type { FormApi, FormState, SubmitResult } from "@formbar/core";
import type { SchemaFormResult } from "@formbar/from-schema";

export type TuiDiagnosticCode =
	| "unsupported-field"
	| "unsupported-layout"
	| "unsupported-option-value"
	| "invalid-renderer-input"
	| "submit-callback-error";

export interface TuiDiagnostic {
	readonly code: TuiDiagnosticCode;
	readonly severity: "warning" | "error";
	readonly message: string;
	readonly path?: string;
}

/** Caller-owned inputs for the future process-free renderer. */
export interface TuiRendererInput<TData, TUi> {
	readonly form: FormApi<TData, TUi>;
	readonly schema: SchemaFormResult;
	readonly onDiagnostic?: ((diagnostic: TuiDiagnostic) => void) | undefined;
}

export interface TuiSubmitSuccessEvent<TData, TUi> {
	readonly result: SubmitResult;
	readonly state: FormState<TData, TUi>;
}

export interface TuiSubmitFailureEvent<TData, TUi> {
	readonly result: SubmitResult;
	readonly state: FormState<TData, TUi>;
}
