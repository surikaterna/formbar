import type { AsyncValidationResult, AsyncValidatorConfig } from "./contracts.js";
import { type AbsoluteDataPath, type DataPathInput, fieldMetaKey, normalizeDataPath } from "./field-policy.js";
import type { FieldMetaEntry, FormState, ValidationIssue } from "./state.js";
import { normalizeIssues } from "./validation.js";

const DEFAULT_DEBOUNCE_MS = 300;
type Cancellation = "superseded" | "aborted";

interface NormalizedValidator<TData, TUi> {
	readonly config: AsyncValidatorConfig<TData, TUi>;
	readonly fields: readonly AbsoluteDataPath[];
}

interface RunToken {
	readonly kind: "automatic" | "foreground";
	readonly id: number;
	revision: number;
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
	reset(): void;
	dispose(): void;
}

interface CoordinatorDeps<TData, TUi> {
	readonly validators: readonly AsyncValidatorConfig<TData, TUi>[];
	readonly getState: () => FormState<TData, TUi>;
	readonly updateState: (updater: (state: FormState<TData, TUi>) => FormState<TData, TUi>) => void;
}

function overlaps(a: AbsoluteDataPath, b: AbsoluteDataPath): boolean {
	const length = Math.min(a.segments.length, b.segments.length);
	for (let index = 0; index < length; index++) {
		if (a.segments[index] !== b.segments[index]) return false;
	}
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
	id: number,
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
		id,
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

export function createValidationCoordinator<TData, TUi>(
	deps: CoordinatorDeps<TData, TUi>,
): ValidationCoordinator<TData, TUi> {
	const validators = normalizeValidators(deps.validators);
	const automatic = new Map<string, RunToken>();
	const active = new Set<RunToken>();
	const generations = new Map<string, number>();
	let foreground: RunToken | undefined;
	let revision = 0;
	let lifecycle = 0;
	let runId = 0;

	function isCurrent(token: RunToken): boolean {
		if (token.cancellation || token.revision !== revision || token.lifecycle !== lifecycle) return false;
		for (const [id, generation] of token.validatorGenerations) {
			if (generations.get(id) !== generation) return false;
		}
		return token.kind === "foreground" ? foreground === token : [...automatic.values()].includes(token);
	}

	function projectValidating(): void {
		const paths = new Set([...active].flatMap((token) => token.paths.map(fieldMetaKey)));
		const current = deps.getState();
		const unchangedGlobal = current.meta.validation.validating === active.size > 0;
		const unchangedFields = Object.entries(current.fieldMeta).every(
			([key, meta]) => meta.isValidating === paths.has(key),
		);
		const hasEveryPath = [...paths].every((key) => key in current.fieldMeta);
		if (unchangedGlobal && unchangedFields && hasEveryPath) return;
		deps.updateState((state) => {
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
				meta: { ...state.meta, validation: { ...state.meta.validation, validating: active.size > 0 } },
			};
		});
	}

	function detach(token: RunToken): void {
		active.delete(token);
		if (token.kind === "foreground" && foreground === token) foreground = undefined;
		for (const id of token.validatorIds) if (automatic.get(id) === token) automatic.delete(id);
	}

	function cancel(token: RunToken, reason: Cancellation): void {
		if (token.cancellation) return;
		token.cancellation = reason;
		if (token.timer) clearTimeout(token.timer);
		token.controller.abort();
		token.resolveCancellation(reason);
		detach(token);
	}

	function cancelAll(reason: Cancellation, project = true): void {
		for (const token of [...active]) cancel(token, reason);
		if (project) projectValidating();
	}

	function replaceIssues(ids: ReadonlySet<string>, issues: readonly ValidationIssue[]): void {
		deps.updateState((state) => ({
			...state,
			issues: normalizeIssues([
				...state.issues.filter(
					(issue) => issue.source.origin !== "async-validator" || !ids.has(issue.source.validatorId),
				),
				...issues,
			]),
		}));
	}

	async function executeValidator(
		validator: NormalizedValidator<TData, TUi>,
		snapshot: { readonly data: TData; readonly uiState: TUi },
		token: RunToken,
	): Promise<readonly ValidationIssue[]> {
		try {
			const issues = await validator.config.validate({ ...snapshot, signal: token.controller.signal });
			return issues.map((issue) => canonicalizeIssue(issue, validator.config.id));
		} catch (error) {
			if (!isCurrent(token)) return [];
			return [exceptionIssue(validator as NormalizedValidator<unknown, unknown>, error)];
		}
	}

	async function runAutomatic(token: RunToken, validator: NormalizedValidator<TData, TUi>): Promise<void> {
		const snapshot = deps.getState();
		const outcome = await Promise.race([
			executeValidator(validator, { data: snapshot.data, uiState: snapshot.uiState }, token),
			token.cancelled,
		]);
		if (Array.isArray(outcome) && isCurrent(token)) replaceIssues(token.validatorIds, outcome);
		if (!isCurrent(token)) return;
		detach(token);
		projectValidating();
	}

	function matching(path: AbsoluteDataPath, trigger: "onChange" | "onBlur") {
		return validators.filter((validator) => {
			if ((validator.config.trigger ?? "onChange") !== trigger) return false;
			return validator.fields.length === 0 || validator.fields.some((field) => overlaps(field, path));
		});
	}

	function schedule(validator: NormalizedValidator<TData, TUi>, triggerPath: AbsoluteDataPath): void {
		const id = validator.config.id;
		const existing = automatic.get(id);
		if (existing) cancel(existing, "superseded");
		if (foreground?.validatorIds.has(id)) cancel(foreground, "superseded");
		const generation = (generations.get(id) ?? 0) + 1;
		generations.set(id, generation);
		const paths = validator.fields.length > 0 ? validator.fields : [triggerPath];
		const token = createToken("automatic", ++runId, revision, lifecycle, new Map([[id, generation]]), paths);
		automatic.set(id, token);
		active.add(token);
		token.timer = setTimeout(() => {
			token.timer = undefined;
			void runAutomatic(token, validator);
		}, validator.config.debounceMs ?? DEFAULT_DEBOUNCE_MS);
	}

	function select(scope?: AbsoluteDataPath) {
		if (!scope) return validators;
		return validators.filter(
			(validator) => validator.fields.length > 0 && validator.fields.some((field) => overlaps(field, scope)),
		);
	}

	async function runForeground(
		selected: readonly NormalizedValidator<TData, TUi>[],
		snapshot: { readonly data: TData; readonly uiState: TUi },
		expectedRevision: number,
		signal?: AbortSignal,
		scope?: AbsoluteDataPath,
	): Promise<AsyncValidationResult> {
		if (selected.length === 0) return { status: "completed", issues: [] };
		if (signal?.aborted) return { status: "aborted", issues: [] };
		if (foreground) cancel(foreground, "superseded");
		const tokenGenerations = new Map<string, number>();
		for (const validator of selected) {
			const id = validator.config.id;
			const auto = automatic.get(id);
			if (auto) cancel(auto, "superseded");
			const generation = (generations.get(id) ?? 0) + 1;
			generations.set(id, generation);
			tokenGenerations.set(id, generation);
		}
		const paths = [...selected.flatMap((validator) => validator.fields), ...(scope ? [scope] : [])];
		const token = createToken("foreground", ++runId, expectedRevision, lifecycle, tokenGenerations, paths);
		foreground = token;
		active.add(token);
		const abort = () => {
			cancel(token, "aborted");
			projectValidating();
		};
		signal?.addEventListener("abort", abort, { once: true });
		projectValidating();
		const validation = Promise.all(selected.map((validator) => executeValidator(validator, snapshot, token)));
		const outcome = await Promise.race([validation, token.cancelled]);
		signal?.removeEventListener("abort", abort);
		if (!Array.isArray(outcome)) return { status: outcome, issues: [] };
		if (!isCurrent(token)) return { status: token.cancellation ?? "superseded", issues: [] };
		const issues = normalizeIssues(outcome.flat());
		replaceIssues(token.validatorIds, issues);
		detach(token);
		projectValidating();
		return { status: "completed", issues };
	}

	function trigger(path: AbsoluteDataPath, event: "onChange" | "onBlur", mutate: boolean): void {
		if (mutate) {
			revision += 1;
			if (foreground) cancel(foreground, "superseded");
			for (const token of automatic.values()) token.revision = revision;
		}
		for (const validator of matching(path, event)) schedule(validator, path);
		projectValidating();
	}

	function endLifecycle(): void {
		lifecycle += 1;
		revision += 1;
		cancelAll("aborted", false);
	}

	return {
		revision: () => revision,
		onMutation: (path, event) => {
			if (path && event) trigger(path, event, true);
			else {
				revision += 1;
				cancelAll("superseded");
			}
		},
		onBlur: (path) => trigger(path, "onBlur", false),
		validate: (scope, signal) => {
			const normalizedScope = scope === undefined ? undefined : normalizeDataPath(scope);
			const state = deps.getState();
			return runForeground(
				select(normalizedScope),
				{ data: state.data, uiState: state.uiState },
				revision,
				signal,
				normalizedScope,
			);
		},
		validateSnapshot: (snapshot, expectedRevision, signal) =>
			runForeground(select(), snapshot, expectedRevision, signal),
		reset: endLifecycle,
		dispose: endLifecycle,
	};
}
