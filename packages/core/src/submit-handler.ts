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
	if (idGenerator) return idGenerator();
	return `submit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getEgressTransforms(options: CreateFormOptions<unknown, unknown>): readonly TransformDefinition[] {
	if (!options.transforms?.length) return [];
	return options.transforms.filter(
		(t): t is TransformDefinition => "transform" in t && typeof (t as TransformDefinition).transform === "function",
	);
}

interface ActiveSubmit {
	readonly generation: number;
	readonly submitId: string;
	readonly controller: AbortController;
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

export function createSubmitHandler<TData, TUi>(deps: SubmitHandlerDeps<TData, TUi>): SubmitHandler {
	const { store, pipelineStore, pipelineOptions, options, plugins, coordinator } = deps;
	let generation = 0;
	let active: ActiveSubmit | undefined;

	function buildContext(context: Partial<SubmitContext> | undefined, submitId: string): SubmitContext {
		const clock = options.clock ?? (() => new Date().toISOString());
		return {
			requestId: context?.requestId ?? submitId,
			at: context?.at ?? clock(),
			...(context?.actorId !== undefined ? { actorId: context.actorId } : {}),
			...(context?.metadata !== undefined ? { metadata: context.metadata } : {}),
		};
	}

	function isCurrent(run: ActiveSubmit): boolean {
		return active === run && generation === run.generation;
	}

	function markRunning(run: ActiveSubmit): void {
		const clock = options.clock ?? (() => new Date().toISOString());
		const tx = store.beginTransaction();
		tx.mutate((state) => ({
			...state,
			meta: {
				...state.meta,
				submitted: true,
				submission: { status: "running", submitId: run.submitId, lastAttemptAt: clock() },
			},
		}));
		store.commitTransaction(tx);
	}

	function complete(run: ActiveSubmit, result: SubmitResult, commitIssues = true): SubmitResult {
		if (!isCurrent(run)) return { ok: false, submitId: run.submitId, reason: "aborted", message: "Submission aborted" };
		const normalizedFieldErrors = result.fieldErrors ? normalizeFieldErrors(result.fieldErrors) : [];
		const tx = store.beginTransaction();
		tx.mutate((state) => ({
			...state,
			meta: applySubmitOutcome(state.meta, result.ok, run.submitId),
			issues: [
				...state.issues,
				...(commitIssues ? normalizedFieldErrors : []),
				...(commitIssues ? (result.fieldIssues ?? []) : []),
				...(commitIssues ? (result.globalIssues ?? []) : []),
			],
		}));
		store.commitTransaction(tx);
		active = undefined;
		return result;
	}

	function fail(
		run: ActiveSubmit,
		reason: SubmitResult["reason"],
		message: string,
		issues: readonly ValidationIssue[] = [],
	): SubmitResult {
		return complete(
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

	function runPipeline(submitContext: SubmitContext) {
		const before = store.getState();
		const result = executePipeline({
			action: { type: "submit" } as FormAction,
			store: pipelineStore,
			options: pipelineOptions,
			submitContext,
			isSubmit: true,
			plugins,
		});
		const after = store.getState();
		if (result.ok && (before.data !== after.data || before.uiState !== after.uiState)) coordinator.onMutation();
		return result;
	}

	function runPluginGates(): readonly ValidationIssue[] {
		const issues: ValidationIssue[] = [];
		const state = store.getState();
		for (const plugin of plugins) {
			const result = plugin.beforeSubmit?.({ data: state.data, uiState: state.uiState });
			if (result) issues.push(...result);
		}
		if (issues.length === 0) return issues;
		const tx = store.beginTransaction();
		tx.mutate((draft) => ({ ...draft, issues: [...draft.issues, ...issues] }));
		store.commitTransaction(tx);
		return issues;
	}

	function payloadFrom(snapshot: FormState<TData, TUi>): TData {
		const transforms = getEgressTransforms(pipelineOptions);
		if (transforms.length === 0) return snapshot.data;
		return runTransforms(transforms, "egress", snapshot.data, { state: snapshot }) as TData;
	}

	function abortRace(signal: AbortSignal): Promise<typeof ABORTED> {
		if (signal.aborted) return Promise.resolve(ABORTED);
		return new Promise((resolve) => signal.addEventListener("abort", () => resolve(ABORTED), { once: true }));
	}

	async function executeHandler(
		run: ActiveSubmit,
		submitContext: SubmitContext,
		snapshot: FormState<TData, TUi>,
	): Promise<SubmitResult> {
		if (!options.onSubmit) return complete(run, { ok: true, submitId: run.submitId });
		try {
			const handler = options.onSubmit({
				form: deps.getApi(),
				submitContext,
				payload: payloadFrom(snapshot),
				signal: run.controller.signal,
			});
			const timed = withTimeout(
				handler,
				options.timeouts?.submit ?? DEFAULT_RUNTIME_CONSTRAINTS.submitTimeout,
				"onSubmit callback timed out",
			);
			const result = await Promise.race([timed, abortRace(run.controller.signal)]);
			if (result === ABORTED || !isCurrent(run)) return fail(run, "aborted", "Submission aborted");
			const completed = complete(run, result);
			await runNotifyHooksAsync(
				(options.middleware ?? []) as readonly Middleware[],
				"afterSubmit",
				{ action: { type: "submit" }, state: store.getState(), result },
				options.timeouts?.middleware ?? DEFAULT_RUNTIME_CONSTRAINTS.middlewareTimeout,
			);
			return completed;
		} catch (error) {
			run.controller.abort();
			return fail(run, undefined, error instanceof Error ? error.message : String(error));
		}
	}

	async function submit(context?: Partial<SubmitContext>, signal?: AbortSignal): Promise<SubmitResult> {
		if (active) {
			throw new FormbarError("FORMBAR_SUBMIT_CONCURRENT", "Submit rejected: a submission is already in progress");
		}
		const run: ActiveSubmit = {
			generation: ++generation,
			submitId: generateSubmitId(options.idGenerator),
			controller: new AbortController(),
		};
		active = run;
		if (signal?.aborted) run.controller.abort();
		else signal?.addEventListener("abort", () => run.controller.abort(), { once: true });
		markRunning(run);
		if (run.controller.signal.aborted) return fail(run, "aborted", "Submission aborted");

		const submitContext = buildContext(context, run.submitId);
		const pipeline = runPipeline(submitContext);
		if (!pipeline.ok) return fail(run, undefined, pipeline.vetoReason ?? pipeline.error ?? "Pipeline failed");
		runPluginGates();
		const snapshot = store.getState();
		const validation = await coordinator.validateSnapshot(
			{ data: snapshot.data, uiState: snapshot.uiState },
			coordinator.revision(),
			run.controller.signal,
		);
		if (validation.status === "aborted") return fail(run, "aborted", "Submission aborted");
		if (validation.status === "superseded") {
			return fail(run, "validation-superseded", "Validation snapshot was superseded");
		}
		if (!isCurrent(run)) return fail(run, "aborted", "Submission aborted");
		const currentIssues = store.getState().issues;
		if (currentIssues.some((issue) => issue.severity === "error")) {
			return fail(run, "validation-failed", "Validation failed", currentIssues);
		}
		return executeHandler(run, submitContext, snapshot);
	}

	function abortActive(): void {
		generation += 1;
		active?.controller.abort();
		active = undefined;
	}

	return { submit, reset: abortActive, dispose: abortActive };
}
