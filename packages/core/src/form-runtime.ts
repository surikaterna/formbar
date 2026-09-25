import { clearAttempt, failedAttemptIssuesForPath } from "./attempt-issues.js";
import type {
	FieldApi,
	FieldConfig,
	FormAction,
	FormApi,
	FormDispatchResult,
	Middleware,
	ValidatorFn,
} from "./contracts.js";
import { computeIsSubmitting, computeIsTouched, computeIsValid } from "./convenience-flags.js";
import { createDisposalSignal } from "./disposal-signal.js";
import { FormbarError } from "./errors.js";
import { createFieldApi } from "./field-api.js";
import { emptyFieldPolicy, fieldMetaKey, normalizeDataPath } from "./field-policy.js";
import { createFormDisposer } from "./form-disposer.js";
import { createListenerRegistry } from "./listener-registry.js";
import { normalizeValidators } from "./normalize-validators.js";
import { parsePath } from "./path-parser.js";
import { issuesForPath } from "./path-relations.js";
import type { CanonicalPath } from "./path.js";
import { executePipeline } from "./pipeline.js";
import { deactivateFormResources, initializeFormResources, validatePluginIds } from "./plugin-initializer.js";
import type { FormPlugin } from "./plugin-types.js";
import { createResetSignal } from "./reset-signal.js";
import { invalidateScopedSync, runScopedSync } from "./scoped-sync.js";
import { createFormStateCapture } from "./state-capture.js";
import type { CreateFormOptions, FieldMetaEntry, FormState, FormStateCapture, ValidationIssue } from "./state.js";
import { FormStore } from "./store.js";
import { createSubmitHandler } from "./submit-handler.js";
import { warnUnknownCreateFormOptionsAtRuntime } from "./unknown-options-warning.js";
import { type ValidationCoordinator, createValidationCoordinator } from "./validation-coordinator.js";

export class FormRuntime<TData, TUi> {
	private initialDataSnapshot: TData;
	private initialUiStateSnapshot: TUi;
	private readonly initialState: FormState<TData, TUi>;
	private readonly store: FormStore<TData, TUi>;
	private readonly listeners = createListenerRegistry();
	private readonly normalizedValidators: readonly ValidatorFn[];
	private readonly plugins: readonly FormPlugin<TData, TUi>[];
	private readonly pluginDisposers: (() => void)[] = [];
	private readonly fieldCache = new Map<string, FieldApi<TData, TUi, string>>();
	private readonly pipelineStore: FormStore<unknown, unknown>;
	private readonly pipelineOptions: CreateFormOptions<unknown, unknown>;
	private readonly coordinator: ValidationCoordinator<TData, TUi>;
	private readonly submitHandler: ReturnType<typeof createSubmitHandler<TData, TUi>>;
	private readonly disposal = createDisposalSignal();
	private readonly resetSignal = createResetSignal();
	private readonly api: FormApi<TData, TUi>;
	private active = false;
	private readonly deferred: boolean;
	private readonly activationSubscriptions: (() => void)[] = [];
	private readonly initializedMiddlewares: Middleware[] = [];
	private deactivating = false;
	constructor(
		private readonly options: CreateFormOptions<TData, TUi>,
		deferred = false,
	) {
		this.deferred = deferred;
		warnUnknownCreateFormOptionsAtRuntime(options);
		this.initialDataSnapshot = structuredClone((options.initialData ?? {}) as TData);
		this.initialUiStateSnapshot = structuredClone((options.initialUiState ?? {}) as TUi);
		this.initialState = this.createInitialState();
		this.store = new FormStore(this.initialState, options.stateStrategy);
		this.normalizedValidators = normalizeValidators(options as CreateFormOptions<unknown, unknown>);
		this.plugins = options.plugins ?? [];
		validatePluginIds(this.plugins);
		this.pipelineStore = this.store as unknown as FormStore<unknown, unknown>;
		this.pipelineOptions = Object.create(options as object, {
			validators: { value: this.normalizedValidators, enumerable: true },
			middleware: { get: () => this.activeMiddlewares, enumerable: true },
		}) as CreateFormOptions<unknown, unknown>;
		this.coordinator = createValidationCoordinator({
			validators: options.asyncValidators ?? [],
			...(options.timeouts?.validator === undefined ? {} : { validatorTimeout: options.timeouts.validator }),
			getState: () => this.store.getState(),
			updateState: (updater) => this.updateState(updater),
		});
		const runtime = this;
		this.submitHandler = createSubmitHandler({
			store: this.store,
			pipelineStore: this.pipelineStore,
			pipelineOptions: this.pipelineOptions,
			options,
			get plugins() {
				return runtime.activePlugins;
			},
			coordinator: this.coordinator,
			getApi: () => this.api,
		});
		this.api = this.createApi();
		if (!deferred) {
			this.active = true;
			this.initialize();
		}
	}
	build(): FormApi<TData, TUi> {
		return this.api;
	}
	private get activePlugins(): readonly FormPlugin<TData, TUi>[] {
		return this.active ? this.plugins : [];
	}
	private get activeMiddlewares(): readonly Middleware[] {
		return this.active ? (this.options.middleware ?? []) : [];
	}
	activate(): void {
		if (this.disposal.isDisposed() || this.active || this.deactivating) return;
		this.active = true;
		try {
			this.initialize();
		} catch (error) {
			this.deactivate();
			throw error;
		}
	}

	deactivate(): void {
		if (!this.deferred || !this.active || this.deactivating) return;
		invalidateScopedSync(this.api);
		this.active = false;
		this.deactivating = true;
		try {
			this.submitHandler.reset();
			this.coordinator.reset();
			if (this.store.getState().attemptValidation) this.updateState(clearAttempt);
			deactivateFormResources(this.initializedMiddlewares, this.pluginDisposers, this.activationSubscriptions);
		} finally {
			this.deactivating = false;
		}
	}
	private createInitialState(): FormState<TData, TUi> {
		return {
			data: structuredClone(this.initialDataSnapshot),
			uiState: structuredClone(this.initialUiStateSnapshot),
			meta: { validation: { validating: false } },
			fieldMeta: {},
			fieldPolicy: emptyFieldPolicy(),
			issues: [],
		};
	}

	private updateState(updater: (draft: FormState<TData, TUi>) => FormState<TData, TUi>): void {
		const tx = this.store.beginTransaction();
		tx.mutate(updater);
		this.store.commitTransaction(tx);
	}

	private resolveInitialValue(path: CanonicalPath): unknown {
		let current: unknown = path.namespace === "data" ? this.initialDataSnapshot : this.initialUiStateSnapshot;
		for (const segment of path.segments) {
			if (current === null || current === undefined) return undefined;
			current = (current as Record<string | number, unknown>)[segment];
		}
		return current;
	}

	private propagateListeners(pathKey: string, trigger: "change" | "blur"): void {
		const targets = this.listeners.getListeners(pathKey, trigger);
		if (targets.length === 0) return;
		const tx = this.store.beginTransaction();
		tx.mutate((draft) => {
			const fieldMeta = { ...draft.fieldMeta } as Record<string, FieldMetaEntry>;
			for (const target of targets) {
				const existing = fieldMeta[target.path];
				fieldMeta[target.path] = {
					touched: existing?.touched ?? false,
					isValidating: existing?.isValidating ?? false,
					dirty: existing?.dirty ?? false,
					listenerTriggered: true,
				};
			}
			return { ...draft, fieldMeta };
		});
		this.store.commitTransaction(tx);
	}

	private dispatchSetValue = (rawPath: string, value: unknown): FormDispatchResult => {
		const before = this.store.getState();
		const result = executePipeline({
			action: { type: "set-value", path: rawPath, value },
			store: this.pipelineStore,
			options: this.pipelineOptions,
			isSubmit: false,
			plugins: this.activePlugins,
		});
		if (result.ok) this.afterSetValue(rawPath, before);
		const error = result.error ?? result.vetoReason;
		return error ? { ok: result.ok, error } : { ok: result.ok };
	};

	private afterSetValue(rawPath: string, before: FormState<TData, TUi>): void {
		const canonical = parsePath(rawPath);
		const after = this.store.getState();
		const mutated = before.data !== after.data || before.uiState !== after.uiState;
		if (mutated && after.attemptValidation) this.updateState(clearAttempt);
		if (mutated && canonical.namespace === "data") {
			const dataPath = normalizeDataPath({ namespace: "data", segments: canonical.segments });
			const pathKey = fieldMetaKey(dataPath);
			this.propagateListeners(pathKey, "change");
			this.coordinator.onMutation(dataPath, "onChange");
		} else if (mutated) this.coordinator.onMutation();
	}

	private dispatch = (action: FormAction): FormDispatchResult => {
		if (action.type === "set-value" && action.path !== undefined)
			return this.dispatchSetValue(action.path, action.value);
		const before = this.store.getState();
		const result = executePipeline({
			action,
			store: this.pipelineStore,
			options: this.pipelineOptions,
			isSubmit: false,
			plugins: this.activePlugins,
		});
		const after = this.store.getState();
		if (result.ok && (before.data !== after.data || before.uiState !== after.uiState) && after.attemptValidation)
			this.updateState(clearAttempt);
		if (result.ok && (before.data !== after.data || before.uiState !== after.uiState)) this.coordinator.onMutation();
		const error = result.error ?? result.vetoReason;
		return error ? { ok: result.ok, error } : { ok: result.ok };
	};

	private validate = (stage?: string): readonly ValidationIssue[] => {
		const state = this.store.getState();
		const activeStage = stage ?? state.meta.stage;
		const allIssues: ValidationIssue[] = [];
		for (const validator of this.normalizedValidators) {
			const base = { data: state.data, uiState: state.uiState };
			const input = activeStage !== undefined ? { ...base, stage: activeStage } : base;
			const result = validator(input);
			if (result instanceof Promise) {
				throw new FormbarError(
					"FORMBAR_ASYNC_IN_SYNC_PIPELINE",
					"Validator returned a Promise in synchronous validate() — use async submit path",
				);
			}
			allIssues.push(...result);
		}
		allIssues.push(...runScopedSync(this.api, activeStage));
		return allIssues;
	};

	private markFieldTouched = (pathKey: string, canonical: CanonicalPath): void => {
		const tx = this.store.beginTransaction();
		tx.mutate((draft) => {
			const existing = (draft.fieldMeta as Record<string, FieldMetaEntry>)[pathKey];
			if (existing?.touched) return draft;
			return {
				...draft,
				fieldMeta: {
					...draft.fieldMeta,
					[pathKey]: {
						touched: true,
						isValidating: existing?.isValidating ?? false,
						dirty: existing?.dirty ?? false,
						listenerTriggered: existing?.listenerTriggered ?? false,
					},
				},
			};
		});
		this.store.commitTransaction(tx);
		this.propagateListeners(pathKey, "blur");
		if (canonical.namespace === "data") {
			this.coordinator.onBlur(normalizeDataPath({ namespace: "data", segments: canonical.segments }));
		}
	};

	private updateFieldMeta = (
		updater: (meta: Record<string, FieldMetaEntry>) => Record<string, FieldMetaEntry>,
	): void => {
		const tx = this.store.beginTransaction();
		tx.mutate((draft) => ({ ...draft, fieldMeta: updater(draft.fieldMeta as Record<string, FieldMetaEntry>) }));
		this.store.commitTransaction(tx);
	};

	private field(path: string, config?: FieldConfig): FieldApi<TData, TUi, string> {
		const cacheKey = config ? `${path}::${JSON.stringify(config)}` : path;
		const cached = this.fieldCache.get(cacheKey);
		if (cached) return cached;
		const canonical = parsePath(path);
		const pathKey =
			canonical.namespace === "data"
				? fieldMetaKey(normalizeDataPath({ namespace: "data", segments: canonical.segments }))
				: path;
		if (config?.validationTriggers) this.listeners.register(pathKey, config.validationTriggers);
		const api = createFieldApi<TData, TUi>({
			path: canonical,
			rawPath: path,
			getState: () => this.store.getState(),
			setValue: this.dispatchSetValue as unknown as (path: string, value: unknown) => FormDispatchResult,
			getIssues: (value) => issuesForPath(this.store.getState().issues, value),
			getAttemptIssues: (value) => failedAttemptIssuesForPath(this.store.getState(), value),
			getInitialValue: () => this.resolveInitialValue(canonical),
			getFieldMeta: (key) => (this.store.getState().fieldMeta as Record<string, FieldMetaEntry>)[key],
			markTouched: this.markFieldTouched,
			getFormSubmitted: () => this.store.getState().meta.submitted ?? false,
			updateFieldMeta: this.updateFieldMeta,
			formDefaults: this.options.fieldDefaults,
			config,
		});
		this.fieldCache.set(cacheKey, api);
		return api;
	}

	private reset = (nextInitial?: { readonly data?: TData; readonly uiState?: TUi }): void => {
		this.submitHandler.reset();
		this.coordinator.reset();
		if (nextInitial?.data !== undefined) this.initialDataSnapshot = structuredClone(nextInitial.data);
		if (nextInitial?.uiState !== undefined) this.initialUiStateSnapshot = structuredClone(nextInitial.uiState);
		const data = structuredClone(nextInitial?.data ?? this.initialDataSnapshot);
		const uiState = structuredClone(nextInitial?.uiState ?? this.initialUiStateSnapshot);
		const tx = this.store.beginTransaction();
		tx.mutate(
			() =>
				({
					data,
					uiState,
					meta: { validation: { validating: false }, submission: { status: "idle" } },
					fieldMeta: {},
					fieldPolicy: emptyFieldPolicy(),
					issues: [],
				}) as FormState<TData, TUi>,
		);
		this.store.commitTransaction(tx);
		this.fieldCache.clear();
		this.listeners.clear();
		this.resetSignal.notify();
		for (const plugin of this.activePlugins) plugin.onReset?.();
	};

	private createApi(): FormApi<TData, TUi> {
		return {
			getState: () => this.store.getState(),
			captureState: this.captureState,
			dispatch: this.dispatch,
			setValue: this.dispatchSetValue,
			validate: this.validate,
			validateAsync: this.coordinator.validate,
			submit: this.submitHandler.submit,
			field: this.field.bind(this) as FormApi<TData, TUi>["field"],
			fieldDynamic: this.field.bind(this) as FormApi<TData, TUi>["fieldDynamic"],
			subscribe: (listener) => this.store.subscribe(listener),
			reset: this.reset,
			canSubmit: () => this.canSubmit(),
			isPristine: () => !this.captureState().isFormDirty(),
			isDirty: () => this.captureState().isFormDirty(),
			isValid: () => computeIsValid(this.store.getState()),
			isSubmitting: () => computeIsSubmitting(this.store.getState()),
			isTouched: () => computeIsTouched(this.store.getState()),
			isDisposed: this.disposal.isDisposed,
			onDispose: this.disposal.onDispose,
			onReset: this.resetSignal.onReset,
			getDisposalDiagnostics: this.disposal.getDiagnostics,
			dispose: this.createDispose(),
		};
	}

	private captureState = (): FormStateCapture<TData, TUi> =>
		createFormStateCapture(this.store.getState(), this.initialDataSnapshot, this.initialUiStateSnapshot);
	private canSubmit(): boolean {
		const state = this.store.getState();
		return !computeIsSubmitting(state) && !state.meta.validation.validating && computeIsValid(state);
	}

	private createDispose(): () => void {
		const permanent = createFormDisposer(this.disposal, {
			abort: this.submitHandler.dispose,
			cancel: this.coordinator.dispose,
			plugins: this.plugins,
			pluginDisposers: this.pluginDisposers,
			middlewares: this.deferred ? [] : (this.options.middleware ?? []),
			clearFields: () => this.fieldCache.clear(),
			clearResetListeners: () => this.resetSignal.clear(),
			disposeStore: () => this.store.dispose(),
		});
		return () => {
			this.deactivate();
			if (this.store.getState().attemptValidation) this.updateState(clearAttempt);
			permanent();
		};
	}
	private initialize(): void {
		initializeFormResources({
			plugins: this.plugins,
			middlewares: this.options.middleware ?? [],
			state: this.store.getState(),
			store: this.store,
			initialData: this.initialDataSnapshot,
			deferred: this.deferred,
			disposers: this.pluginDisposers,
			subscriptions: this.activationSubscriptions,
			initializedMiddlewares: this.initializedMiddlewares,
			isActive: () => this.active && !this.disposal.isDisposed(),
			dispatch: (action) => {
				this.dispatch(action);
			},
		});
	}
}
