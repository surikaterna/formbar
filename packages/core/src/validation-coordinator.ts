import type { AsyncValidationResult, AsyncValidatorConfig } from "./contracts.js";
import { type AbsoluteDataPath, type DataPathInput, fieldMetaKey, normalizeDataPath } from "./field-policy.js";
import type { FieldMetaEntry, FormState, SubmitContext, ValidationIssue } from "./state.js";
import { DEFAULT_RUNTIME_CONSTRAINTS } from "./timeout.js";
import { normalizeIssues } from "./validation.js";

const DEFAULT_DEBOUNCE_MS = 300;
type Cancellation = "superseded" | "aborted";

interface NormalizedValidator<TData, TUi> {
	readonly config: AsyncValidatorConfig<TData, TUi>;
	readonly fields: readonly AbsoluteDataPath[];
}

interface RunToken {
	readonly kind: "automatic" | "foreground";
	readonly revision: number;
	readonly lifecycle: number;
	readonly validatorGenerations: ReadonlyMap<string, number>;
	readonly validatorIds: ReadonlySet<string>;
	readonly paths: readonly AbsoluteDataPath[];
	readonly controller: AbortController;
	readonly cancelled: Promise<Cancellation>;
	resolveCancellation(reason: Cancellation): void;
	cancellation?: Cancellation;
	timer?: ReturnType<typeof setTimeout> | undefined;
}

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
		options?: { readonly stage?: string; readonly context?: SubmitContext },
	): Promise<AsyncValidationResult>;
	reset(): void;
	dispose(): void;
}

interface CoordinatorDeps<TData, TUi> {
	readonly validators: readonly AsyncValidatorConfig<TData, TUi>[];
	readonly validatorTimeout?: number;
	readonly getState: () => FormState<TData, TUi>;
	readonly updateState: (updater: (state: FormState<TData, TUi>) => FormState<TData, TUi>) => void;
}

function overlaps(a: AbsoluteDataPath, b: AbsoluteDataPath): boolean {
	const length = Math.min(a.segments.length, b.segments.length);
	for (let index = 0; index < length; index++) if (a.segments[index] !== b.segments[index]) return false;
	return true;
}

function normalizeValidators<TData, TUi>(configs: readonly AsyncValidatorConfig<TData, TUi>[]) {
	const ids = new Set<string>();
	return configs.map((config) => {
		if (!config.id || ids.has(config.id)) throw new Error(`Async validator id must be unique: "${config.id}"`);
		ids.add(config.id);
		return { config, fields: Object.freeze((config.fields ?? []).map(normalizeDataPath)) };
	});
}

function canonicalizeIssue(issue: ValidationIssue, validatorId: string): ValidationIssue {
	const path =
		issue.path.namespace === "data" && issue.path.segments.length > 0
			? normalizeDataPath({ namespace: "data", segments: issue.path.segments })
			: issue.path;
	return { ...issue, path, source: { ...issue.source, origin: "async-validator", validatorId } };
}

function exceptionIssue(validator: NormalizedValidator<unknown, unknown>, error: unknown): ValidationIssue {
	return {
		code: "ASYNC_VALIDATOR_EXCEPTION",
		message: error instanceof Error ? error.message : String(error),
		severity: "error",
		path: validator.fields[0] ?? { namespace: "data", segments: [] },
		source: { origin: "async-validator", validatorId: validator.config.id },
	};
}

function createToken(
	kind: RunToken["kind"],
	revision: number,
	lifecycle: number,
	validatorGenerations: ReadonlyMap<string, number>,
	paths: readonly AbsoluteDataPath[],
): RunToken {
	let resolveCancellation!: (reason: Cancellation) => void;
	const cancelled = new Promise<Cancellation>((resolve) => {
		resolveCancellation = resolve;
	});
	return {
		kind,
		revision,
		lifecycle,
		validatorGenerations,
		validatorIds: new Set(validatorGenerations.keys()),
		paths,
		controller: new AbortController(),
		cancelled,
		resolveCancellation,
	};
}

class ValidationRuntime<TData, TUi> {
	private readonly validators: readonly NormalizedValidator<TData, TUi>[];
	private readonly automatic = new Map<string, RunToken>();
	private readonly automaticPaths = new Map<string, AbsoluteDataPath>();
	private readonly active = new Set<RunToken>();
	private readonly generations = new Map<string, number>();
	private foreground: RunToken | undefined;
	private currentRevision = 0;
	private lifecycle = 0;
	private disposed = false;

	constructor(private readonly deps: CoordinatorDeps<TData, TUi>) {
		this.validators = normalizeValidators(deps.validators);
	}

	api(): ValidationCoordinator<TData, TUi> {
		return {
			revision: () => this.currentRevision,
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
		for (const [id, generation] of token.validatorGenerations) {
			if (this.generations.get(id) !== generation) return false;
		}
		return token.kind === "foreground" ? this.foreground === token : [...this.automatic.values()].includes(token);
	}

	private desiredPaths(): Set<string> {
		return new Set([...this.active].flatMap((token) => token.paths.map(fieldMetaKey)));
	}

	private projectionChanged(paths: ReadonlySet<string>): boolean {
		const current = this.deps.getState();
		if (current.meta.validation.validating !== this.active.size > 0) return true;
		if ([...paths].some((key) => !(key in current.fieldMeta))) return true;
		return Object.entries(current.fieldMeta).some(([key, meta]) => meta.isValidating !== paths.has(key));
	}

	private projectValidating(): void {
		const paths = this.desiredPaths();
		if (!this.projectionChanged(paths)) return;
		this.deps.updateState((state) => {
			const fieldMeta = { ...state.fieldMeta } as Record<string, FieldMetaEntry>;
			for (const [key, meta] of Object.entries(fieldMeta)) {
				const validating = paths.has(key);
				if (meta.isValidating !== validating) fieldMeta[key] = { ...meta, isValidating: validating };
				paths.delete(key);
			}
			for (const key of paths) {
				fieldMeta[key] = { touched: false, dirty: false, listenerTriggered: false, isValidating: true };
			}
			return {
				...state,
				fieldMeta,
				meta: { ...state.meta, validation: { ...state.meta.validation, validating: this.active.size > 0 } },
			};
		});
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

	private async executeValidator(
		validator: NormalizedValidator<TData, TUi>,
		snapshot: { readonly data: TData; readonly uiState: TUi },
		token: RunToken,
		options?: { readonly stage?: string; readonly context?: SubmitContext },
	): Promise<readonly ValidationIssue[]> {
		try {
			const issues = await validator.config.validate({ ...snapshot, signal: token.controller.signal, ...options });
			return issues.map((issue) => canonicalizeIssue(issue, validator.config.id));
		} catch (error) {
			if (!this.isCurrent(token)) return [];
			return [exceptionIssue(validator as NormalizedValidator<unknown, unknown>, error)];
		}
	}

	private async runAutomatic(token: RunToken, validator: NormalizedValidator<TData, TUi>): Promise<void> {
		const state = this.deps.getState();
		const snapshot = { data: state.data, uiState: state.uiState };
		const outcome = await Promise.race([this.executeValidator(validator, snapshot, token), token.cancelled]);
		if (Array.isArray(outcome) && this.isCurrent(token)) this.replaceIssues(token.validatorIds, outcome);
		if (!this.isCurrent(token)) return;
		this.detach(token);
		this.projectValidating();
	}

	private matching(path: AbsoluteDataPath, trigger: "onChange" | "onBlur") {
		return this.validators.filter((validator) => {
			if ((validator.config.trigger ?? "onChange") !== trigger) return false;
			return validator.fields.length === 0 || validator.fields.some((field) => overlaps(field, path));
		});
	}

	private nextGeneration(id: string): number {
		const generation = (this.generations.get(id) ?? 0) + 1;
		this.generations.set(id, generation);
		return generation;
	}

	private schedule(validator: NormalizedValidator<TData, TUi>, triggerPath: AbsoluteDataPath): void {
		const id = validator.config.id;
		const existing = this.automatic.get(id);
		if (existing) this.cancel(existing, "superseded");
		if (this.foreground?.validatorIds.has(id)) this.cancel(this.foreground, "superseded");
		const token = createToken(
			"automatic",
			this.currentRevision,
			this.lifecycle,
			new Map([[id, this.nextGeneration(id)]]),
			validator.fields.length > 0 ? validator.fields : [triggerPath],
		);
		this.automatic.set(id, token);
		this.automaticPaths.set(id, triggerPath);
		this.active.add(token);
		token.timer = setTimeout(() => {
			token.timer = undefined;
			void this.runAutomatic(token, validator);
		}, validator.config.debounceMs ?? DEFAULT_DEBOUNCE_MS);
	}

	private select(scope?: AbsoluteDataPath) {
		if (!scope) return this.validators;
		return this.validators.filter(
			(validator) => validator.fields.length > 0 && validator.fields.some((field) => overlaps(field, scope)),
		);
	}

	private startForeground(selected: readonly NormalizedValidator<TData, TUi>[], paths: readonly AbsoluteDataPath[]) {
		if (this.foreground) this.cancel(this.foreground, "superseded");
		const tokenGenerations = new Map<string, number>();
		for (const validator of selected) {
			const id = validator.config.id;
			const automatic = this.automatic.get(id);
			if (automatic) this.cancel(automatic, "superseded");
			tokenGenerations.set(id, this.nextGeneration(id));
		}
		const token = createToken("foreground", this.currentRevision, this.lifecycle, tokenGenerations, paths);
		this.foreground = token;
		this.active.add(token);
		return token;
	}

	private async runForeground(
		selected: readonly NormalizedValidator<TData, TUi>[],
		snapshot: { readonly data: TData; readonly uiState: TUi },
		expectedRevision: number,
		signal?: AbortSignal,
		scope?: AbsoluteDataPath,
		options?: { readonly stage?: string; readonly context?: SubmitContext },
		candidate = false,
	): Promise<AsyncValidationResult> {
		if (!candidate && selected.length === 0) return { status: "completed", issues: [] };
		if (signal?.aborted) return { status: "aborted", issues: [] };
		if (candidate && this.disposed) return { status: "aborted", issues: [] };
		if (candidate && expectedRevision !== this.currentRevision) return { status: "superseded", issues: [] };
		if (selected.length === 0) return { status: "completed", issues: [] };
		const paths = [...selected.flatMap((validator) => validator.fields), ...(scope ? [scope] : [])];
		const token = this.startForeground(selected, paths);
		if (expectedRevision !== this.currentRevision) this.cancel(token, "superseded");
		const abort = () => {
			this.cancel(token, "aborted");
			this.projectValidating();
		};
		signal?.addEventListener("abort", abort, { once: true });
		this.projectValidating();
		if (candidate && !token.cancellation) {
			const timeout = this.deps.validatorTimeout ?? DEFAULT_RUNTIME_CONSTRAINTS.validatorTimeout;
			token.timer = setTimeout(abort, Math.max(0, timeout));
		}
		const validation = Promise.all(
			selected.map((validator) => this.executeValidator(validator, snapshot, token, options)),
		);
		const outcome = await Promise.race([validation, token.cancelled]);
		if (token.timer) clearTimeout(token.timer);
		signal?.removeEventListener("abort", abort);
		if (!Array.isArray(outcome)) return { status: outcome, issues: [] };
		if (!this.isCurrent(token)) return { status: token.cancellation ?? "superseded", issues: [] };
		const issues = normalizeIssues(outcome.flat());
		if (!candidate) this.replaceIssues(token.validatorIds, issues);
		this.detach(token);
		this.projectValidating();
		return { status: "completed", issues };
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
		const selected = this.matching(path, event);
		if (mutate) {
			this.currentRevision += 1;
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
		this.cancelAll("superseded");
	}

	private validate(scope?: DataPathInput, signal?: AbortSignal): Promise<AsyncValidationResult> {
		const normalizedScope = scope === undefined ? undefined : normalizeDataPath(scope);
		const state = this.deps.getState();
		const snapshot = { data: state.data, uiState: state.uiState };
		return this.runForeground(this.select(normalizedScope), snapshot, this.currentRevision, signal, normalizedScope);
	}

	private endLifecycle(project: boolean): void {
		if (project) this.disposed = true;
		this.lifecycle += 1;
		this.currentRevision += 1;
		this.cancelAll("aborted", project);
	}
}

export function createValidationCoordinator<TData, TUi>(
	deps: CoordinatorDeps<TData, TUi>,
): ValidationCoordinator<TData, TUi> {
	return new ValidationRuntime(deps).api();
}
