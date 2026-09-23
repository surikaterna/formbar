import type { FormAction, FormApi, Middleware, SubmitResult } from "./contracts.js";
import { FormbarError } from "./errors.js";
import { runNotifyHooksAsync } from "./middleware-runner.js";
import { parsePath } from "./path-parser.js";
import { executePipeline } from "./pipeline.js";
import type { FormPlugin } from "./plugin-types.js";
import type { CreateFormOptions, FormState, SubmitContext, ValidationIssue } from "./state.js";
import type { FormStore } from "./store.js";
import { applySubmitOutcome } from "./submit.js";
import { DEFAULT_RUNTIME_CONSTRAINTS, withTimeout } from "./timeout.js";
import { type TransformDefinition, runTransforms } from "./transforms.js";
import type { ValidationCoordinator } from "./validation-coordinator.js";

const ABORTED = Symbol("submit-aborted");

function normalizeFieldErrors(fieldErrors: Readonly<Record<string, string>>): ValidationIssue[] {
	return Object.entries(fieldErrors).map(([path, message]) => ({
		code: "SUBMIT_ERROR",
		message,
		severity: "error" as const,
		path: parsePath(`data.${path}`),
		source: { origin: "submit" as const, validatorId: "onSubmit" },
	}));
}

function generateSubmitId(idGenerator?: () => string): string {
	return idGenerator ? idGenerator() : `submit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getEgressTransforms(options: CreateFormOptions<unknown, unknown>): readonly TransformDefinition[] {
	if (!options.transforms?.length) return [];
	return options.transforms.filter(
		(transform): transform is TransformDefinition =>
			"transform" in transform && typeof (transform as TransformDefinition).transform === "function",
	);
}

function rejectThenablePluginGate(pluginId: string, result: unknown): void {
	if ((typeof result !== "object" && typeof result !== "function") || result === null) return;
	let then: unknown;
	try {
		then = Reflect.get(result, "then");
	} catch {
		throw new FormbarError(
			"FORMBAR_ASYNC_IN_SYNC_PIPELINE",
			`Plugin "${pluginId}" beforeSubmit must return issues synchronously`,
		);
	}
	if (typeof then !== "function") return;
	void Promise.resolve(result).then(
		() => undefined,
		() => undefined,
	);
	throw new FormbarError(
		"FORMBAR_ASYNC_IN_SYNC_PIPELINE",
		`Plugin "${pluginId}" beforeSubmit must return issues synchronously`,
	);
}

interface ActiveSubmit {
	readonly generation: number;
	readonly submitId: string;
	readonly controller: AbortController;
	readonly callerSignal?: AbortSignal;
	readonly callerAbort?: () => void;
}

export interface SubmitHandlerDeps<TData, TUi> {
	readonly store: FormStore<TData, TUi>;
	readonly pipelineStore: FormStore<unknown, unknown>;
	readonly pipelineOptions: CreateFormOptions<unknown, unknown>;
	readonly options: CreateFormOptions<TData, TUi>;
	readonly plugins: readonly FormPlugin<TData, TUi>[];
	readonly coordinator: ValidationCoordinator<TData, TUi>;
	readonly getApi: () => FormApi<TData, TUi>;
}

export interface SubmitHandler {
	submit(context?: Partial<SubmitContext>, signal?: AbortSignal): Promise<SubmitResult>;
	reset(): void;
	dispose(): void;
}

class SubmitRuntime<TData, TUi> {
	private generation = 0;
	private active: ActiveSubmit | undefined;

	constructor(private readonly deps: SubmitHandlerDeps<TData, TUi>) {}

	api(): SubmitHandler {
		return {
			submit: (context, signal) => this.submit(context, signal),
			reset: () => this.abortActive(),
			dispose: () => this.abortActive(),
		};
	}

	private buildContext(context: Partial<SubmitContext> | undefined, submitId: string): SubmitContext {
		const clock = this.deps.options.clock ?? (() => new Date().toISOString());
		return {
			requestId: context?.requestId ?? submitId,
			at: context?.at ?? clock(),
			...(context?.actorId !== undefined ? { actorId: context.actorId } : {}),
			...(context?.metadata !== undefined ? { metadata: context.metadata } : {}),
		};
	}

	private isCurrent(run: ActiveSubmit): boolean {
		return this.active === run && this.generation === run.generation;
	}

	private markRunning(run: ActiveSubmit): void {
		const clock = this.deps.options.clock ?? (() => new Date().toISOString());
		const tx = this.deps.store.beginTransaction();
		tx.mutate((state) => ({
			...state,
			meta: {
				...state.meta,
				submitted: true,
				submission: { status: "running", submitId: run.submitId, lastAttemptAt: clock() },
			},
		}));
		this.deps.store.commitTransaction(tx);
	}

	private complete(run: ActiveSubmit, result: SubmitResult, commitIssues = true): SubmitResult {
		if (!this.isCurrent(run))
			return { ok: false, submitId: run.submitId, reason: "aborted", message: "Submission aborted" };
		const canonical = { ...result, submitId: run.submitId };
		const fieldErrors = canonical.fieldErrors ? normalizeFieldErrors(canonical.fieldErrors) : [];
		const tx = this.deps.store.beginTransaction();
		tx.mutate((state) => ({
			...state,
			meta: applySubmitOutcome(state.meta, canonical.ok, run.submitId),
			issues: [
				...state.issues,
				...(commitIssues ? fieldErrors : []),
				...(commitIssues ? (canonical.fieldIssues ?? []) : []),
				...(commitIssues ? (canonical.globalIssues ?? []) : []),
			],
		}));
		this.deps.store.commitTransaction(tx);
		this.removeCallerListener(run);
		this.active = undefined;
		return canonical;
	}

	private fail(
		run: ActiveSubmit,
		reason: SubmitResult["reason"],
		message: string,
		issues: readonly ValidationIssue[] = [],
	): SubmitResult {
		return this.complete(
			run,
			{
				ok: false,
				submitId: run.submitId,
				...(reason ? { reason } : {}),
				message,
				fieldIssues: issues,
			},
			false,
		);
	}

	private runPipeline(submitContext: SubmitContext) {
		const before = this.deps.store.getState();
		const result = executePipeline({
			action: { type: "submit" } as FormAction,
			store: this.deps.pipelineStore,
			options: this.deps.pipelineOptions,
			submitContext,
			isSubmit: true,
			plugins: this.deps.plugins,
		});
		const after = this.deps.store.getState();
		if (result.ok && (before.data !== after.data || before.uiState !== after.uiState)) {
			this.deps.coordinator.onMutation();
		}
		return result;
	}

	private commitPluginIssues(issues: readonly ValidationIssue[]): readonly ValidationIssue[] {
		if (issues.length === 0) return issues;
		const tx = this.deps.store.beginTransaction();
		tx.mutate((draft) => ({ ...draft, issues: [...draft.issues, ...issues] }));
		this.deps.store.commitTransaction(tx);
		return issues;
	}

	private runPluginGates(): readonly ValidationIssue[] {
		const issues: ValidationIssue[] = [];
		const state = this.deps.store.getState();
		for (const plugin of this.deps.plugins) {
			const result = plugin.beforeSubmit?.({ data: state.data, uiState: state.uiState });
			rejectThenablePluginGate(plugin.id, result);
			if (result) issues.push(...result);
		}
		return this.commitPluginIssues(issues);
	}

	private payloadFrom(snapshot: FormState<TData, TUi>): TData {
		const transforms = getEgressTransforms(this.deps.pipelineOptions);
		if (transforms.length === 0) return snapshot.data;
		return runTransforms(transforms, "egress", snapshot.data, { state: snapshot }) as TData;
	}

	private createAbortWaiter(signal: AbortSignal) {
		if (signal.aborted) return { promise: Promise.resolve(ABORTED), cleanup: () => {} };
		let resolve!: (value: typeof ABORTED) => void;
		const onAbort = () => resolve(ABORTED);
		const promise = new Promise<typeof ABORTED>((complete) => {
			resolve = complete;
			signal.addEventListener("abort", onAbort, { once: true });
		});
		return { promise, cleanup: () => signal.removeEventListener("abort", onAbort) };
	}

	private async executeHandler(
		run: ActiveSubmit,
		submitContext: SubmitContext,
		snapshot: FormState<TData, TUi>,
	): Promise<SubmitResult> {
		if (!this.deps.options.onSubmit) return this.complete(run, { ok: true, submitId: run.submitId });
		try {
			const handler = this.deps.options.onSubmit({
				form: this.deps.getApi(),
				submitContext,
				payload: this.payloadFrom(snapshot),
				signal: run.controller.signal,
			});
			const timed = withTimeout(
				handler,
				this.deps.options.timeouts?.submit ?? DEFAULT_RUNTIME_CONSTRAINTS.submitTimeout,
				"onSubmit callback timed out",
			);
			const abortWaiter = this.createAbortWaiter(run.controller.signal);
			const result = await Promise.race([timed, abortWaiter.promise]).finally(abortWaiter.cleanup);
			if (result === ABORTED || !this.isCurrent(run)) return this.fail(run, "aborted", "Submission aborted");
			return await this.finishHandler(run, result);
		} catch (error) {
			run.controller.abort();
			return this.fail(run, undefined, error instanceof Error ? error.message : String(error));
		}
	}

	private async finishHandler(run: ActiveSubmit, result: SubmitResult): Promise<SubmitResult> {
		const completed = this.complete(run, result);
		await runNotifyHooksAsync(
			(this.deps.pipelineOptions.middleware ?? []) as readonly Middleware[],
			"afterSubmit",
			{ action: { type: "submit" }, state: this.deps.store.getState(), result: completed },
			this.deps.options.timeouts?.middleware ?? DEFAULT_RUNTIME_CONSTRAINTS.middlewareTimeout,
		);
		return completed;
	}

	private createRun(signal?: AbortSignal): ActiveSubmit {
		const controller = new AbortController();
		const callerAbort = () => controller.abort();
		const run: ActiveSubmit = {
			generation: ++this.generation,
			submitId: generateSubmitId(this.deps.options.idGenerator),
			controller,
			...(signal ? { callerSignal: signal, callerAbort } : {}),
		};
		this.active = run;
		if (signal?.aborted) controller.abort();
		else signal?.addEventListener("abort", callerAbort, { once: true });
		this.markRunning(run);
		return run;
	}

	private async validateRun(run: ActiveSubmit, snapshot: FormState<TData, TUi>): Promise<SubmitResult | undefined> {
		const validation = await this.deps.coordinator.validateSnapshot(
			{ data: snapshot.data, uiState: snapshot.uiState },
			this.deps.coordinator.revision(),
			run.controller.signal,
		);
		if (validation.status === "aborted") return this.fail(run, "aborted", "Submission aborted");
		if (validation.status === "superseded") {
			return this.fail(run, "validation-superseded", "Validation snapshot was superseded");
		}
		if (!this.isCurrent(run)) return this.fail(run, "aborted", "Submission aborted");
		const issues = this.deps.store.getState().issues;
		if (issues.some((issue) => issue.severity === "error")) {
			return this.fail(run, "validation-failed", "Validation failed", issues);
		}
	}

	private async submit(context?: Partial<SubmitContext>, signal?: AbortSignal): Promise<SubmitResult> {
		if (this.active) {
			throw new FormbarError("FORMBAR_SUBMIT_CONCURRENT", "Submit rejected: a submission is already in progress");
		}
		const run = this.createRun(signal);
		if (run.controller.signal.aborted) return this.fail(run, "aborted", "Submission aborted");
		try {
			const submitContext = this.buildContext(context, run.submitId);
			const pipeline = this.runPipeline(submitContext);
			if (!pipeline.ok) return this.fail(run, undefined, pipeline.vetoReason ?? pipeline.error ?? "Pipeline failed");
			this.runPluginGates();
			const snapshot = this.deps.store.getState();
			const failure = await this.validateRun(run, snapshot);
			return failure ?? this.executeHandler(run, submitContext, snapshot);
		} catch (error) {
			run.controller.abort();
			return this.fail(run, undefined, error instanceof Error ? error.message : String(error));
		}
	}

	private removeCallerListener(run: ActiveSubmit): void {
		if (run.callerSignal && run.callerAbort) run.callerSignal.removeEventListener("abort", run.callerAbort);
	}

	private abortActive(): void {
		this.generation += 1;
		if (this.active) this.removeCallerListener(this.active);
		this.active?.controller.abort();
		this.active = undefined;
	}
}

export function createSubmitHandler<TData, TUi>(deps: SubmitHandlerDeps<TData, TUi>): SubmitHandler {
	return new SubmitRuntime(deps).api();
}
