import { automaticFailureIssue } from "./async-issue-adapter.js";
import { type NormalizedValidator, normalizeAsyncValidators } from "./async-validator-normalization.js";
import type { AsyncValidationResult } from "./contracts.js";
import { type AbsoluteDataPath, type DataPathInput, fieldMetaKey, normalizeDataPath } from "./field-policy.js";
import type { FinalGeneration } from "./final-generation.js";
import { ownIssues } from "./issue-ownership.js";
import { ownedSemanticGuard } from "./owned-semantic-guard.js";
import type { ScopedForeground } from "./scoped-async-scheduler.js";
import { publishCoordinatorForeground } from "./scoped-foreground-publication.js";
import type { ValidationIssue } from "./state.js";
import { snapshotOwnership } from "./store.js";
import { DEFAULT_RUNTIME_CONSTRAINTS } from "./timeout.js";
import type { CoordinatorDeps } from "./validation-coordinator-deps.js";
import {
	type Cancellation,
	type RunToken,
	createToken,
	executeValidator,
	isSettledCurrent,
	nextValidatorGeneration,
	prepareForegroundScope,
	selectValidators,
} from "./validation-coordinator-support.js";
import { settleForeground } from "./validation-foreground-settlement.js";
import { projectValidationStatus } from "./validation-status-projection.js";
import { normalizeIssues } from "./validation.js";

const DEFAULT_DEBOUNCE_MS = 300;

export interface ValidationCoordinator<TData, TUi> {
	readonly revision: () => number;
	onMutation(path?: AbsoluteDataPath, trigger?: "onChange" | "onBlur"): void;
	onBlur(path: AbsoluteDataPath): void;
	validate(scope?: DataPathInput, signal?: AbortSignal): Promise<AsyncValidationResult>;
	validateSnapshot(
		snapshot: { readonly data: TData; readonly uiState: TUi },
		revision: number,
		signal?: AbortSignal,
	): Promise<AsyncValidationResult>;
	/** Validate a candidate without publishing its issues into the retained draft lane. */
	validateCandidate(
		snapshot: { readonly data: TData; readonly uiState: TUi },
		expectedRevision: number,
		signal?: AbortSignal,
		options?: Parameters<NonNullable<CoordinatorDeps<TData, TUi>["runScopedCandidate"]>>[3] & {
			readonly finalGeneration?: FinalGeneration;
		},
	): Promise<AsyncValidationResult>;
	/** Internal read-only per-form foreground generation. */
	readonly foregroundRevision: () => number;
	reset(): void;
	dispose(): void;
}

class ValidationRuntime<TData, TUi> {
	private readonly validators: readonly NormalizedValidator<TData, TUi>[];
	private readonly automatic = new Map<string, RunToken>();
	private readonly automaticPaths = new Map<string, AbsoluteDataPath>();
	private readonly active = new Set<RunToken>();
	private readonly generations = new Map<string, number>();
	private foreground: RunToken | undefined;
	private foregroundGeneration = 0;
	private currentRevision = 0;
	private lifecycle = 0;
	private disposed = false;
	constructor(private readonly deps: CoordinatorDeps<TData, TUi>) {
		this.validators = normalizeAsyncValidators(deps.validators);
	}
	api(): ValidationCoordinator<TData, TUi> {
		return {
			revision: () => this.currentRevision,
			foregroundRevision: () => this.foregroundGeneration,
			onMutation: (path, event) => this.onMutation(path, event),
			onBlur: (path) => this.trigger(path, "onBlur", false),
			validate: (scope, signal) => this.validate(scope, signal),
			validateSnapshot: (snapshot, revision, signal) => this.runForeground(this.validators, snapshot, revision, signal),
			validateCandidate: (snapshot, revision, signal, options) =>
				this.runForeground(this.validators, snapshot, revision, signal, undefined, options, true),
			reset: () => this.endLifecycle(false),
			dispose: () => this.endLifecycle(true),
		};
	}
	private isCurrent(token: RunToken): boolean {
		if (token.cancellation || token.revision !== this.currentRevision || token.lifecycle !== this.lifecycle)
			return false;
		if (token.semanticCurrent && !token.semanticCurrent()) return false;
		for (const [id, generation] of token.validatorGenerations) {
			if (this.generations.get(id) !== generation) return false;
		}
		return token.kind === "foreground" ? this.foreground === token : [...this.automatic.values()].includes(token);
	}
	private projectValidating(): void {
		const paths = new Set([...this.active].flatMap((token) => token.paths.map(fieldMetaKey)));
		projectValidationStatus(this.deps, paths, this.active.size > 0);
	}
	private detach(token: RunToken): void {
		this.active.delete(token);
		if (token.kind === "foreground" && this.foreground === token) this.foreground = undefined;
		for (const id of token.validatorIds) {
			if (this.automatic.get(id) !== token) continue;
			this.automatic.delete(id);
			this.automaticPaths.delete(id);
		}
	}
	private cancel(token: RunToken, reason: Cancellation): void {
		if (token.cancellation) return;
		token.cancellation = reason;
		if (token.timer) clearTimeout(token.timer);
		token.controller.abort();
		token.resolveCancellation(reason);
		this.detach(token);
	}
	private cancelAll(reason: Cancellation, project = true): void {
		for (const token of [...this.active]) this.cancel(token, reason);
		if (project) this.projectValidating();
	}
	private replaceIssues(ids: ReadonlySet<string>, issues: readonly ValidationIssue[]): void {
		if (this.deps.replaceAsyncIssues) {
			this.deps.replaceAsyncIssues(ids, issues);
			return;
		}
		this.deps.updateState((state) => ({
			...state,
			issues: normalizeIssues([
				...state.issues.filter(
					(issue) => issue.source.origin !== "async-validator" || !ids.has(issue.source.validatorId),
				),
				...issues,
			]),
		}));
	}

	private executeValidator(
		validator: NormalizedValidator<TData, TUi>,
		snapshot: { readonly data: TData; readonly uiState: TUi },
		token: RunToken,
		options?: { readonly stage?: string; readonly context?: import("./state.js").SubmitContext },
	) {
		return executeValidator(
			validator,
			snapshot,
			token,
			options,
			() => this.isCurrent(token),
			() => snapshotOwnership(this.deps.getState())?.owned === true,
		);
	}
	private async runAutomatic(token: RunToken, validator: NormalizedValidator<TData, TUi>): Promise<void> {
		const state = this.deps.getState();
		const snapshot = { data: state.data, uiState: state.uiState };
		try {
			const outcome = await Promise.race([this.executeValidator(validator, snapshot, token), token.cancelled]);
			if (Array.isArray(outcome) && this.isCurrent(token)) this.replaceIssues(token.validatorIds, outcome);
		} catch {
			if (this.isCurrent(token)) {
				this.replaceIssues(token.validatorIds, ownIssues([automaticFailureIssue(validator)]));
			}
		} finally {
			if (this.active.has(token)) {
				this.detach(token);
				this.projectValidating();
			}
		}
	}

	private schedule(validator: NormalizedValidator<TData, TUi>, triggerPath: AbsoluteDataPath): void {
		this.foregroundGeneration++;
		const id = validator.config.id;
		const existing = this.automatic.get(id);
		if (existing) this.cancel(existing, "superseded");
		if (this.foreground?.validatorIds.has(id)) this.cancel(this.foreground, "superseded");
		const token = createToken(
			"automatic",
			this.currentRevision,
			this.lifecycle,
			new Map([[id, nextValidatorGeneration(this.generations, id)]]),
			validator.fields.length > 0 ? validator.fields : [triggerPath],
		);
		this.automatic.set(id, token);
		token.semanticCurrent = ownedSemanticGuard(this.deps.getState);
		this.automaticPaths.set(id, triggerPath);
		this.active.add(token);
		token.timer = setTimeout(() => {
			token.timer = undefined;
			void this.runAutomatic(token, validator).catch(() => {
				try {
					console.error("ASYNC_VALIDATOR_FAILURE_REPORT_FAILED");
				} catch {
					// Reporting must not create another unhandled rejection.
				}
			});
		}, validator.config.debounceMs ?? DEFAULT_DEBOUNCE_MS);
	}

	private startForeground(selected: readonly NormalizedValidator<TData, TUi>[], paths: readonly AbsoluteDataPath[]) {
		this.foregroundGeneration++;
		if (this.foreground) this.cancel(this.foreground, "superseded");
		const tokenGenerations = new Map<string, number>();
		for (const validator of selected) {
			const id = validator.config.id;
			const automatic = this.automatic.get(id);
			if (automatic) this.cancel(automatic, "superseded");
			tokenGenerations.set(id, nextValidatorGeneration(this.generations, id));
		}
		const token = createToken("foreground", this.currentRevision, this.lifecycle, tokenGenerations, paths);
		this.foreground = token;
		this.active.add(token);
		return token;
	}

	private async awaitForeground(
		validation: Promise<(readonly ValidationIssue[])[]>,
		token: RunToken,
		signal: AbortSignal | undefined,
		abort: () => void,
	): Promise<(readonly ValidationIssue[])[] | Cancellation> {
		try {
			return await Promise.race([validation, token.cancelled]);
		} catch (error) {
			this.cancel(token, "superseded");
			this.projectValidating();
			throw error;
		} finally {
			if (token.timer) clearTimeout(token.timer);
			signal?.removeEventListener("abort", abort);
		}
	}
	private staleForeground(token: RunToken): AsyncValidationResult {
		if (this.active.has(token)) {
			this.cancel(token, "superseded");
			this.projectValidating();
		}
		return { status: token.cancellation ?? "superseded", issues: [] };
	}

	private async runForeground(
		selected: readonly NormalizedValidator<TData, TUi>[],
		snapshot: { readonly data: TData; readonly uiState: TUi },
		expectedRevision: number,
		signal?: AbortSignal,
		scope?: DataPathInput,
		options?: Parameters<NonNullable<CoordinatorDeps<TData, TUi>["runScopedCandidate"]>>[3] & {
			readonly finalGeneration?: FinalGeneration;
		},
		candidate = false,
		includeScoped = false,
	): Promise<AsyncValidationResult> {
		const candidateScoped = candidate && !!this.deps.hasScopedAsync?.();
		const runCandidate = this.deps.runScopedCandidate;
		if (!candidate && selected.length === 0 && (!includeScoped || !this.deps.hasScopedAsync?.()))
			return { status: "completed", issues: [] };
		if (signal?.aborted) return { status: "aborted", issues: [] };
		if (candidate && this.disposed) return { status: "aborted", issues: [] };
		if (candidate && expectedRevision !== this.currentRevision) return { status: "superseded", issues: [] };
		if (candidateScoped && !runCandidate) throw new Error("Missing scoped FINAL runner");
		if (selected.length === 0 && !includeScoped && !candidateScoped && !candidate)
			return { status: "completed", issues: [] };
		const semanticCurrent = ownedSemanticGuard(this.deps.getState);
		const paths = [...selected.flatMap((validator) => validator.fields), ...(scope ? [normalizeDataPath(scope)] : [])];
		const token = this.startForeground(selected, paths);
		if (options?.finalGeneration && !options.finalGeneration.async.begin(this.foregroundGeneration))
			return this.staleForeground(token);
		const scoped = prepareForegroundScope(
			token,
			() => (includeScoped ? this.deps.prepareScopedForeground?.(scope, token.controller.signal, snapshot) : undefined),
			() => this.cancel(token, "superseded"),
		);
		if (expectedRevision !== this.currentRevision) this.cancel(token, "superseded");
		const abort = () => {
			this.cancel(token, "aborted");
			this.projectValidating();
		};
		signal?.addEventListener("abort", abort, { once: true });
		this.projectValidating();
		if (!semanticCurrent()) this.cancel(token, "superseded");
		if ((candidate || scoped) && !token.cancellation) {
			const timeout = this.deps.validatorTimeout ?? DEFAULT_RUNTIME_CONSTRAINTS.validatorTimeout;
			token.timer = setTimeout(abort, Math.max(0, timeout));
		}
		const validation = Promise.all([
			...selected.map((validator) => this.executeValidator(validator, snapshot, token, options)),
			...(scoped ? [scoped.run()] : []),
			...(candidateScoped && runCandidate
				? [runCandidate(snapshot, token.controller.signal, expectedRevision, options)]
				: []),
		]);
		const outcome = await this.awaitForeground(validation, token, signal, abort);
		if (!Array.isArray(outcome)) return { status: outcome, issues: [] };
		const result = this.completeForeground(token, outcome, scoped, candidate, signal, semanticCurrent);
		if (result.status === "completed") options?.finalGeneration?.async.settle(this.foregroundGeneration);
		return result;
	}

	private completeForeground(
		token: RunToken,
		outcome: (readonly ValidationIssue[])[],
		scoped: ScopedForeground | undefined,
		candidate: boolean,
		signal: AbortSignal | undefined,
		semanticCurrent: () => boolean,
	): AsyncValidationResult {
		return settleForeground({
			token,
			outcome,
			scoped,
			candidate,
			signal,
			semanticCurrent,
			isCurrent: () => this.isCurrent(token),
			stale: () => this.staleForeground(token),
			publish: (legacy, scopedIssues) =>
				publishCoordinatorForeground(
					scoped,
					token.validatorIds,
					legacy,
					scopedIssues,
					(ids, result) => this.replaceIssues(ids, result),
					this.deps.publishScopedForeground,
				),
			fail: () => {
				this.cancel(token, "superseded");
				this.projectValidating();
			},
			generation: () => this.foregroundGeneration,
			detach: () => this.detach(token),
			project: () => this.projectValidating(),
			isSettledCurrent: (generation) =>
				isSettledCurrent(
					token,
					generation,
					this.foregroundGeneration,
					this.lifecycle,
					this.currentRevision,
					this.generations,
				),
		});
	}

	private rescheduleUnrelated(selectedIds: ReadonlySet<string>): void {
		const retained = [...this.automaticPaths].filter(([id]) => !selectedIds.has(id));
		for (const token of [...this.automatic.values()]) this.cancel(token, "superseded");
		for (const [id, path] of retained) {
			const validator = this.validators.find((entry) => entry.config.id === id);
			if (validator) this.schedule(validator, path);
		}
	}

	private trigger(path: AbsoluteDataPath, event: "onChange" | "onBlur", mutate: boolean): void {
		const selected = selectValidators(this.validators, path, event);
		if (mutate) {
			this.currentRevision += 1;
			this.foregroundGeneration++;
			if (this.foreground) this.cancel(this.foreground, "superseded");
			this.rescheduleUnrelated(new Set(selected.map((validator) => validator.config.id)));
		}
		for (const validator of selected) this.schedule(validator, path);
		this.projectValidating();
	}

	private onMutation(path?: AbsoluteDataPath, event?: "onChange" | "onBlur"): void {
		if (path && event) {
			this.trigger(path, event, true);
			return;
		}
		this.currentRevision += 1;
		this.foregroundGeneration++;
		this.cancelAll("superseded");
	}

	private validate(scope?: DataPathInput, signal?: AbortSignal): Promise<AsyncValidationResult> {
		const normalizedScope = scope === undefined ? undefined : normalizeDataPath(scope);
		const state = this.deps.getState();
		const snapshot = { data: state.data, uiState: state.uiState };
		return this.runForeground(
			selectValidators(this.validators, normalizedScope),
			snapshot,
			this.currentRevision,
			signal,
			scope,
			undefined,
			false,
			true,
		);
	}

	private endLifecycle(project: boolean): void {
		if (project) this.disposed = true;
		this.lifecycle += 1;
		this.currentRevision += 1;
		this.foregroundGeneration++;
		this.cancelAll("aborted", project);
	}
}

export function createValidationCoordinator<TData, TUi>(
	deps: CoordinatorDeps<TData, TUi>,
): ValidationCoordinator<TData, TUi> {
	return new ValidationRuntime(deps).api();
}
