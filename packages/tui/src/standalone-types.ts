import type { ReadStream, WriteStream } from "node:tty";
import type { FormApi, FormState, SubmitResult } from "@formbar/core";
import type { LayoutNode, SchemaFormResult } from "@formbar/from-schema";

export type StandaloneFormOwnership = "caller" | "host";
export type StandaloneSignal = "SIGHUP" | "SIGINT" | "SIGTERM";
export type StandaloneExitReason = "ctrl-c" | "submit" | "signal" | "unmount";

/** The subset of Ink's key description needed by the deterministic normalizer. */
export interface StandaloneInputKey {
	readonly return?: boolean;
	readonly escape?: boolean;
	readonly tab?: boolean;
	readonly backspace?: boolean;
	readonly delete?: boolean;
	readonly upArrow?: boolean;
	readonly downArrow?: boolean;
	readonly leftArrow?: boolean;
	readonly rightArrow?: boolean;
	readonly pageUp?: boolean;
	readonly pageDown?: boolean;
	readonly ctrl?: boolean;
	readonly shift?: boolean;
	readonly meta?: boolean;
}

export type StandaloneInput =
	| { readonly kind: "exit"; readonly reason: "ctrl-c" }
	| { readonly kind: "action"; readonly input: string; readonly textFallback?: string }
	| { readonly kind: "text"; readonly text: string };

export interface StandaloneExitResult {
	readonly reason: StandaloneExitReason;
	readonly signal?: StandaloneSignal;
}

export interface StandaloneOptions<TData, TUi> {
	readonly form: FormApi<TData, TUi>;
	readonly schema: SchemaFormResult;
	readonly layout?: LayoutNode;
	readonly stdin?: ReadStream;
	readonly stdout?: WriteStream;
	readonly stderr?: WriteStream;
	readonly formOwnership?: StandaloneFormOwnership;
	readonly exitOnSubmit?: boolean;
	readonly signals?: readonly StandaloneSignal[];
	readonly autoFocusFirstError?: boolean;
	readonly onDiagnostic?: (diagnostic: StandaloneDiagnostic) => void;
	readonly onSubmitSuccess?: (event: StandaloneSubmitEvent<TData, TUi>) => void;
	readonly onSubmitFailure?: (event: StandaloneSubmitEvent<TData, TUi>) => void;
}

export interface StandaloneDiagnostic {
	readonly code:
		| "unsupported-field"
		| "unsupported-layout"
		| "unsupported-option-value"
		| "invalid-renderer-input"
		| "submit-callback-error";
	readonly severity: "warning" | "error";
	readonly message: string;
	readonly path?: string;
}

export interface StandaloneSubmitEvent<TData, TUi> {
	readonly result: SubmitResult;
	readonly state: FormState<TData, TUi>;
}

export interface StandaloneInstance {
	waitUntilExit(): Promise<StandaloneExitResult>;
	unmount(): void;
}
