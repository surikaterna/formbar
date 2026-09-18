import type { FormApi, FormState, SubmitResult, ValidationIssue } from "@formbar/core";
import { parsePath } from "@formbar/core";
import type { TuiDiagnostic, TuiSubmitFailureEvent, TuiSubmitSuccessEvent } from "./contracts.js";
import type { InteractionTarget } from "./interaction.js";
import type { FormNavigationSession } from "./navigation-session.js";
import type { NavigationModel } from "./navigation.js";
import { sameTarget } from "./renderer-bindings.js";

export type SubmissionStatus = "idle" | "pending" | "success" | "failure";

export interface ProjectedIssue {
	readonly owner: string | undefined;
	readonly location: "field" | "form" | "unavailable";
	readonly message: string;
	readonly severity: ValidationIssue["severity"];
}

export interface SubmissionSnapshot {
	readonly status: SubmissionStatus;
	readonly issues: readonly ProjectedIssue[];
	readonly callbackDiagnostic: TuiDiagnostic | undefined;
}

export interface SubmissionCallbackRefs<TData, TUi> {
	current: {
		autoFocusFirstError: boolean;
		onSuccess: ((event: TuiSubmitSuccessEvent<TData, TUi>) => void) | undefined;
		onFailure: ((event: TuiSubmitFailureEvent<TData, TUi>) => void) | undefined;
		onDiagnostic: ((diagnostic: TuiDiagnostic) => void) | undefined;
	};
}

interface SubmissionInputs<TData, TUi> {
	readonly form: FormApi<TData, TUi>;
	readonly navigation: NavigationModel;
	readonly session: FormNavigationSession;
	readonly disabled: ReadonlySet<string>;
	readonly callbacks: SubmissionCallbackRefs<TData, TUi>;
	readonly emit: () => void;
}

export interface SubmissionController {
	submit(): boolean;
	observe(state: FormState<unknown, unknown>): void;
	getSnapshot(): SubmissionSnapshot;
	dispose(): void;
}

export function createSubmissionController<TData, TUi>(inputs: SubmissionInputs<TData, TUi>): SubmissionController {
	return new SubmissionState(inputs);
}

class SubmissionState<TData, TUi> implements SubmissionController {
	#active = true;
	#generation = 0;
	#pending: Promise<SubmitResult> | undefined;
	#status: SubmissionStatus = "idle";
	#issues: readonly ProjectedIssue[] = [];
	#callbackDiagnostic: TuiDiagnostic | undefined;
	#submitted: boolean;

	constructor(readonly inputs: SubmissionInputs<TData, TUi>) {
		this.#submitted = inputs.form.getState().meta.submitted === true;
	}

	observe = (state: FormState<unknown, unknown>): void => {
		if (!this.#active) return;
		const reset = this.#submitted && state.meta.submitted !== true;
		this.#submitted = state.meta.submitted === true;
		if (reset) {
			this.#generation += 1;
			this.#status = "idle";
			this.#issues = [];
			this.#callbackDiagnostic = undefined;
			this.inputs.emit();
			return;
		}
		this.#issues = this.#submitted ? projectIssues(state.issues, this.inputs.navigation) : [];
		if (!this.#pending) this.#status = formStatus(state);
	};

	submit = (): boolean => {
		if (!this.#active || this.#pending || this.inputs.form.isSubmitting() || this.inputs.form.isDisposed()) return true;
		const attempt = this.#generation;
		this.#status = "pending";
		this.#callbackDiagnostic = undefined;
		this.inputs.emit();
		try {
			this.#pending = Promise.resolve(this.inputs.form.submit());
		} catch {
			this.#status = "failure";
			this.inputs.emit();
			return true;
		}
		const owned = this.#pending;
		owned.then(
			(result) => this.#settle(result, attempt, owned),
			() => this.#reject(attempt, owned),
		);
		return true;
	};

	getSnapshot = (): SubmissionSnapshot => ({
		status: this.#status,
		issues: this.#issues,
		callbackDiagnostic: this.#callbackDiagnostic,
	});

	dispose = (): void => {
		this.#active = false;
		this.#generation += 1;
	};

	#settle(result: SubmitResult, attempt: number, owned: Promise<SubmitResult>): void {
		if (this.#pending === owned) this.#pending = undefined;
		if (!this.#active || attempt !== this.#generation || this.inputs.form.isDisposed()) return;
		const state = this.inputs.form.getState();
		this.#status = result.ok ? "success" : "failure";
		this.#issues = state.meta.submitted === true ? projectIssues(state.issues, this.inputs.navigation) : [];
		if (!result.ok && this.inputs.callbacks.current.autoFocusFirstError) focusFirstError(state.issues, this.inputs);
		invokeCallback(result, state, this.inputs.callbacks, () => this.#reportCallbackError(attempt));
		this.inputs.emit();
	}

	#reject(attempt: number, owned: Promise<SubmitResult>): void {
		if (this.#pending === owned) this.#pending = undefined;
		if (!this.#active || attempt !== this.#generation || this.inputs.form.isDisposed()) return;
		this.#status = "failure";
		this.inputs.emit();
	}

	#reportCallbackError(attempt: number): void {
		if (!this.#active || attempt !== this.#generation) return;
		this.#callbackDiagnostic = fixedCallbackDiagnostic();
		try {
			this.inputs.callbacks.current.onDiagnostic?.(this.#callbackDiagnostic);
		} catch {}
	}
}

function fixedCallbackDiagnostic(): TuiDiagnostic {
	return { code: "submit-callback-error", severity: "error", message: "Submit callback failed" };
}

function formStatus(state: FormState<unknown, unknown>): SubmissionStatus {
	if (state.meta.submitted !== true) return "idle";
	const status = state.meta.submission?.status;
	if (status === "running") return "pending";
	if (status === "succeeded") return "success";
	if (status === "failed") return "failure";
	return "idle";
}

function invokeCallback<TData, TUi>(
	result: SubmitResult,
	state: FormState<TData, TUi>,
	refs: SubmissionCallbackRefs<TData, TUi>,
	onError: () => void,
): void {
	try {
		if (result.ok) refs.current.onSuccess?.({ result, state });
		else refs.current.onFailure?.({ result, state });
	} catch {
		onError();
	}
}

function focusFirstError<TData, TUi>(
	issues: readonly ValidationIssue[],
	inputs: Pick<SubmissionInputs<TData, TUi>, "disabled" | "form" | "navigation" | "session">,
): void {
	const paths = inputs.navigation.fields.map(({ path }) => path);
	const errorPaths = new Set(
		issues
			.filter(({ severity }) => severity === "error")
			.map((issue) => ownerFor(issue, paths))
			.filter(isString),
	);
	const path = paths.find((candidate) => errorPaths.has(candidate) && !inputs.disabled.has(candidate));
	if (!path) return;
	const before = inputs.session.getSelectedTarget();
	const target: InteractionTarget = { kind: "field", path };
	if (!inputs.session.focus(target) || sameTarget(before, target) || before?.kind !== "field") return;
	inputs.form.fieldDynamic(before.path).handleBlur();
}

function projectIssues(issues: readonly ValidationIssue[], navigation: NavigationModel): readonly ProjectedIssue[] {
	const paths = navigation.fields.map(({ path }) => path);
	const projected = issues.map((issue, index) => ({ issue, index, owner: ownerFor(issue, paths) }));
	return projected
		.sort(
			(left, right) =>
				issueOrder(left.issue, left.owner, paths) - issueOrder(right.issue, right.owner, paths) ||
				left.index - right.index,
		)
		.map(({ issue, owner }) => ({
			owner,
			location:
				issue.path.namespace === "data" && issue.path.segments.length === 0 ? "form" : owner ? "field" : "unavailable",
			message: issue.message,
			severity: issue.severity,
		}));
}

function issueOrder(issue: ValidationIssue, owner: string | undefined, paths: readonly string[]): number {
	if (owner) return paths.indexOf(owner);
	return paths.length + (issue.path.namespace === "data" && issue.path.segments.length === 0 ? 0 : 1);
}

function ownerFor(issue: ValidationIssue, paths: readonly string[]): string | undefined {
	if (issue.path.namespace !== "data" || issue.path.segments.length === 0) return undefined;
	let best: string | undefined;
	let bestLength = -1;
	for (const path of paths) {
		let segments: readonly (string | number)[];
		try {
			segments = parsePath(path).segments;
		} catch {
			continue;
		}
		if (segments.length <= bestLength || !isPrefix(segments, issue.path.segments)) continue;
		best = path;
		bestLength = segments.length;
	}
	return best;
}

function isPrefix(prefix: readonly (string | number)[], value: readonly (string | number)[]): boolean {
	return prefix.length <= value.length && prefix.every((segment, index) => segment === value[index]);
}

function isString(value: string | undefined): value is string {
	return value !== undefined;
}
