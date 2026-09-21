import type {
	FieldApi,
	FieldConfig,
	FormAction,
	FormApi,
	FormDispatchResult,
	Middleware,
	ValidatorFn,
} from "./contracts.js";
import { computeIsPristine, computeIsSubmitting, computeIsTouched, computeIsValid } from "./convenience-flags.js";
import { createDisposalSignal } from "./disposal-signal.js";
import { FormbarError } from "./errors.js";
import { createFieldApi } from "./field-api.js";
import { emptyFieldPolicy, fieldMetaKey, normalizeDataPath } from "./field-policy.js";
import { createFormDisposer } from "./form-disposer.js";
import { createListenerRegistry } from "./listener-registry.js";
import { initMiddlewares } from "./middleware-runner.js";
import { parsePath } from "./path-parser.js";
import type { CanonicalPath } from "./path.js";
import { executePipeline } from "./pipeline.js";
import type { FormPlugin, PluginInitContext } from "./plugin-types.js";
import { createStandardSchemaValidator, isStandardSchemaLike } from "./standard-schema.js";
import type { CreateFormOptions, FieldMetaEntry, FormState, ValidationIssue } from "./state.js";
import { FormStore } from "./store.js";
import { createSubmitHandler } from "./submit-handler.js";
import { warnUnknownCreateFormOptionsAtRuntime } from "./unknown-options-warning.js";
import { type ValidationCoordinator, createValidationCoordinator } from "./validation-coordinator.js";

function pathEquals(a: CanonicalPath, b: CanonicalPath): boolean {
	return (
		a.namespace === b.namespace &&
		a.segments.length === b.segments.length &&
		a.segments.every((seg, i) => seg === b.segments[i])
	);
}

function pathStartsWith(path: CanonicalPath, prefix: CanonicalPath): boolean {
	return (
		path.namespace === prefix.namespace &&
		path.segments.length >= prefix.segments.length &&
		prefix.segments.every((seg, i) => seg === path.segments[i])
	);
}

function normalizeValidators(options: CreateFormOptions<unknown, unknown>): readonly ValidatorFn[] {
	return (options.validators ?? []).map((validator) => {
		if (typeof validator === "function") return validator as ValidatorFn;
		if (isStandardSchemaLike(validator)) return createStandardSchemaValidator(validator);
		throw new FormbarError("FORMBAR_INVALID_VALIDATOR", "Validator must be a function or a Standard Schema v1 object");
	});
}

function validatePluginIds<TData, TUi>(plugins: readonly FormPlugin<TData, TUi>[]): void {
	const ids = new Set<string>();
	for (const plugin of plugins) {
		if (!plugin.id || ids.has(plugin.id)) throw new Error(`Plugin id must be unique: "${plugin.id}"`);
		ids.add(plugin.id);
	}
}

export class FormRuntime<TData, TUi> {
	private initialDataSnapshot: TData;
	private readonly initialUiStateSnapshot: TUi;
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
	private readonly api: FormApi<TData, TUi>;

	constructor(private readonly options: CreateFormOptions<TData, TUi>) {
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
		}) as CreateFormOptions<unknown, unknown>;
		this.coordinator = createValidationCoordinator({
			validators: options.asyncValidators ?? [],
			getState: () => this.store.getState(),
			updateState: (updater) => this.updateState(updater),
		});
		this.submitHandler = createSubmitHandler({
			store: this.store,
			pipelineStore: this.pipelineStore,
			pipelineOptions: this.pipelineOptions,
			options,
			plugins: this.plugins,
			coordinator: this.coordinator,
			getApi: () => this.api,
		});
		this.api = this.createApi();
		this.initialize();
	}

	build(): FormApi<TData, TUi> {
		return this.api;
	}

	private createInitialState(): FormState<TData, TUi> {
		return {
			data: (this.options.initialData ?? {}) as TData,
			uiState: (this.options.initialUiState ?? {}) as TUi,
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

	private resolveInitialValue(segments: readonly (string | number)[]): unknown {
		let current: unknown = this.initialDataSnapshot;
		for (const segment of segments) {
			if (current === null || current === undefined) return undefined;
			current = (current as Record<string | number, unknown>)[segment];
		}
		return current;
	}

	private getIssues(path: CanonicalPath): readonly ValidationIssue[] {
		return this.store
			.getState()
			.issues.filter((issue) => pathEquals(issue.path, path) || pathStartsWith(issue.path, path));
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
			plugins: this.plugins,
		});
		if (result.ok) this.afterSetValue(rawPath, before);
		const error = result.error ?? result.vetoReason;
		return error ? { ok: result.ok, error } : { ok: result.ok };
	};

	private afterSetValue(rawPath: string, before: FormState<TData, TUi>): void {
		const canonical = parsePath(rawPath);
		const after = this.store.getState();
		const mutated = before.data !== after.data || before.uiState !== after.uiState;
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
			plugins: this.plugins,
		});
		const after = this.store.getState();
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
			getIssues: (value) => this.getIssues(value),
			getInitialValue: () => this.resolveInitialValue(canonical.segments),
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
		for (const plugin of this.plugins) plugin.onReset?.();
	};

	private createApi(): FormApi<TData, TUi> {
		return {
			getState: () => this.store.getState(),
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
			isPristine: () => computeIsPristine(this.store.getState(), this.initialDataSnapshot),
			isDirty: () => !computeIsPristine(this.store.getState(), this.initialDataSnapshot),
			isValid: () => computeIsValid(this.store.getState()),
			isSubmitting: () => computeIsSubmitting(this.store.getState()),
			isTouched: () => computeIsTouched(this.store.getState()),
			isDisposed: this.disposal.isDisposed,
			onDispose: this.disposal.onDispose,
			getDisposalDiagnostics: this.disposal.getDiagnostics,
			dispose: this.createDispose(),
		};
	}

	private canSubmit(): boolean {
		const state = this.store.getState();
		return !computeIsSubmitting(state) && !state.meta.validation.validating && computeIsValid(state);
	}

	private createDispose(): () => void {
		return createFormDisposer(this.disposal, {
			abort: this.submitHandler.dispose,
			cancel: this.coordinator.dispose,
			plugins: this.plugins,
			pluginDisposers: this.pluginDisposers,
			middlewares: this.options.middleware ?? [],
			clearFields: () => this.fieldCache.clear(),
			disposeStore: () => this.store.dispose(),
		});
	}

	private initialize(): void {
		initMiddlewares((this.options.middleware ?? []) as readonly Middleware[], { state: this.initialState });
		for (const plugin of this.plugins) {
			if (!plugin.onInit) continue;
			const context: PluginInitContext<TData, TUi> = {
				getState: () => ({ data: this.store.getState().data, uiState: this.store.getState().uiState }),
				subscribe: (listener) =>
					this.store.subscribe((state) => listener({ data: state.data, uiState: state.uiState })),
				dispatch: (action) => {
					this.dispatch({ ...action, origin: `plugin:${plugin.id}` });
				},
				initialData: this.initialDataSnapshot,
			};
			const disposer = plugin.onInit(context);
			if (disposer) this.pluginDisposers.push(disposer);
		}
	}
}
