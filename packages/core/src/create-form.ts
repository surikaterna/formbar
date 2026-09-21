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
import { fieldMetaKey, normalizeDataPath } from "./field-policy.js";
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
import { createValidationCoordinator } from "./validation-coordinator.js";

function pathEquals(a: CanonicalPath, b: CanonicalPath): boolean {
	if (a.namespace !== b.namespace) return false;
	if (a.segments.length !== b.segments.length) return false;
	return a.segments.every((seg, i) => seg === b.segments[i]);
}

function pathStartsWith(path: CanonicalPath, prefix: CanonicalPath): boolean {
	if (path.namespace !== prefix.namespace) return false;
	if (path.segments.length < prefix.segments.length) return false;
	return prefix.segments.every((seg, i) => seg === path.segments[i]);
}

/**
 * Creates a fully-configured form instance with transactional state management,
 * validation pipeline, and optional rule engine integration.
 *
 * @param options - Configuration for the form instance including initial data,
 *   validators, middleware, transforms, and arbiter rules.
 * @returns A {@link FormApi} instance with methods for state access, field manipulation,
 *   validation, and submission.
 *
 * @example
 * ```typescript
 * import { createForm } from "@formbar/core";
 *
 * const form = createForm({
 *   initialData: { name: "", email: "" },
 *   validators: [myValidator],
 *   onSubmit: async ({ payload }) => {
 *     await api.save(payload);
 *     return { ok: true, submitId: "1" };
 *   },
 * });
 *
 * form.setValue("name", "Alice");
 * const result = await form.submit();
 * ```
 */
export function createForm<TData, TUi>(
	options: CreateFormOptions<TData, TUi> = {} as CreateFormOptions<TData, TUi>,
): FormApi<TData, TUi> {
	warnUnknownCreateFormOptionsAtRuntime(options);
	const disposal = createDisposalSignal();
	let initialDataSnapshot: TData = structuredClone((options.initialData ?? {}) as TData);
	const initialUiStateSnapshot: TUi = structuredClone((options.initialUiState ?? {}) as TUi);

	// Justified: runtime data matches TData/TUi, narrowing for consumer DX
	const initialState = {
		data: (options.initialData ?? {}) as TData,
		uiState: (options.initialUiState ?? {}) as TUi,
		meta: { validation: { validating: false } },
		fieldMeta: {},
		fieldPolicy: [],
		issues: [],
	} as FormState<TData, TUi>;

	const store = new FormStore<TData, TUi>(initialState, options.stateStrategy);
	const listeners = createListenerRegistry();

	// Normalize validators: auto-wrap Standard Schema objects as ValidatorFn
	const normalizedValidators: ValidatorFn[] = (options.validators ?? []).map((v) => {
		if (typeof v === "function") return v as ValidatorFn;
		if (isStandardSchemaLike(v)) return createStandardSchemaValidator(v);
		throw new FormbarError("FORMBAR_INVALID_VALIDATOR", "Validator must be a function or a Standard Schema v1 object");
	});

	function resolveInitialValue(segments: readonly (string | number)[]): unknown {
		let current: unknown = initialDataSnapshot;
		for (const seg of segments) {
			if (current === null || current === undefined) return undefined;
			current = (current as Record<string | number, unknown>)[seg];
		}
		return current;
	}

	// Plugin lifecycle
	const plugins: readonly FormPlugin<TData, TUi>[] = options.plugins ?? [];
	const pluginIds = new Set<string>();
	for (const plugin of plugins) {
		if (!plugin.id || pluginIds.has(plugin.id)) throw new Error(`Plugin id must be unique: "${plugin.id}"`);
		pluginIds.add(plugin.id);
	}
	const pluginDisposers: (() => void)[] = [];

	const fieldCache = new Map<string, FieldApi<TData, TUi, string>>();

	function getIssues(path: CanonicalPath): readonly ValidationIssue[] {
		return store.getState().issues.filter((issue) => pathEquals(issue.path, path) || pathStartsWith(issue.path, path));
	}

	// Justified: pipeline treats data as opaque; variance cast is safe at this internal boundary
	const pipelineStore = store as unknown as import("./store.js").FormStore<unknown, unknown>;
	const pipelineOptions = Object.create(options as object, {
		validators: { value: normalizedValidators, enumerable: true },
	}) as CreateFormOptions<unknown, unknown>;

	function updateState(updater: (draft: FormState<unknown, unknown>) => FormState<unknown, unknown>): void {
		const tx = store.beginTransaction();
		// Justified: internal boundary — TData/TUi erased for async manager
		tx.mutate(updater as (draft: FormState<TData, TUi>) => FormState<TData, TUi>);
		store.commitTransaction(tx);
	}

	const validationCoordinator = createValidationCoordinator<TData, TUi>({
		validators: options.asyncValidators ?? [],
		getState: () => store.getState(),
		updateState: (updater) =>
			updateState(updater as (state: FormState<unknown, unknown>) => FormState<unknown, unknown>),
	});

	function propagateListeners(pathKey: string, trigger: "change" | "blur"): void {
		const targets = listeners.getListeners(pathKey, trigger);
		if (targets.length === 0) return;
		const tx = store.beginTransaction();
		tx.mutate((draft) => {
			const meta = { ...draft.fieldMeta } as Record<string, FieldMetaEntry>;
			for (const t of targets) {
				const existing = meta[t.path];
				meta[t.path] = {
					touched: existing?.touched ?? false,
					isValidating: existing?.isValidating ?? false,
					dirty: existing?.dirty ?? false,
					listenerTriggered: true,
				};
			}
			return { ...draft, fieldMeta: meta };
		});
		store.commitTransaction(tx);
	}

	function dispatchSetValue(rawPath: string, value: unknown): FormDispatchResult {
		const before = store.getState();
		const result = executePipeline({
			action: { type: "set-value", path: rawPath, value },
			store: pipelineStore,
			options: pipelineOptions,
			isSubmit: false,
			plugins,
		});
		if (result.ok) {
			const canonical = parsePath(rawPath);
			const after = store.getState();
			const mutated = before.data !== after.data || before.uiState !== after.uiState;
			if (mutated && canonical.namespace === "data") {
				const dataPath = normalizeDataPath({ namespace: "data", segments: canonical.segments });
				const pathKey = fieldMetaKey(dataPath);
				propagateListeners(pathKey, "change");
				validationCoordinator.onMutation(dataPath, "onChange");
			} else if (mutated) validationCoordinator.onMutation();
		}
		const errorMsg = result.error ?? result.vetoReason;
		return errorMsg ? { ok: result.ok, error: errorMsg } : { ok: result.ok };
	}

	function dispatch(action: FormAction): FormDispatchResult {
		if (action.type === "set-value" && action.path !== undefined) return dispatchSetValue(action.path, action.value);
		const before = store.getState();
		const result = executePipeline({
			action,
			store: pipelineStore,
			options: pipelineOptions,
			isSubmit: false,
			plugins,
		});
		const after = store.getState();
		if (result.ok && (before.data !== after.data || before.uiState !== after.uiState))
			validationCoordinator.onMutation();
		const errorMsg = result.error ?? result.vetoReason;
		return errorMsg ? { ok: result.ok, error: errorMsg } : { ok: result.ok };
	}

	function validate(stage?: string): readonly ValidationIssue[] {
		const state = store.getState();
		const activeStage = stage ?? state.meta.stage;
		if (!normalizedValidators.length) return [];
		const allIssues: ValidationIssue[] = [];
		for (const v of normalizedValidators) {
			const base = { data: state.data, uiState: state.uiState };
			const input = activeStage !== undefined ? { ...base, stage: activeStage } : base;
			const result = v(input);
			if (result instanceof Promise) {
				throw new FormbarError(
					"FORMBAR_ASYNC_IN_SYNC_PIPELINE",
					"Validator returned a Promise in synchronous validate() — use async submit path",
				);
			}
			allIssues.push(...result);
		}
		return allIssues;
	}

	function markFieldTouched(pathKey: string): void {
		const tx = store.beginTransaction();
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
		store.commitTransaction(tx);
		propagateListeners(pathKey, "blur");
		const canonical = parsePath(pathKey);
		if (canonical.namespace === "data") {
			validationCoordinator.onBlur(normalizeDataPath({ namespace: "data", segments: canonical.segments }));
		}
	}

	function updateFieldMeta(updater: (meta: Record<string, FieldMetaEntry>) => Record<string, FieldMetaEntry>): void {
		const tx = store.beginTransaction();
		tx.mutate((draft) => ({ ...draft, fieldMeta: updater(draft.fieldMeta as Record<string, FieldMetaEntry>) }));
		store.commitTransaction(tx);
	}

	function field(path: string, config?: FieldConfig): FieldApi<TData, TUi, string> {
		const cacheKey = config ? `${path}::${JSON.stringify(config)}` : path;
		const cached = fieldCache.get(cacheKey);
		if (cached) return cached;
		const canonical = parsePath(path);
		const pathKey =
			canonical.namespace === "data"
				? fieldMetaKey(normalizeDataPath({ namespace: "data", segments: canonical.segments }))
				: path;
		if (config?.validationTriggers) listeners.register(pathKey, config.validationTriggers);
		const fieldApi = createFieldApi<TData, TUi>({
			path: canonical,
			rawPath: path,
			getState: () => store.getState(),
			// Justified: runtime path parsing validates path; cast bridges generic method signature
			setValue: dispatchSetValue as unknown as (path: string, value: unknown) => FormDispatchResult,
			getIssues: (p) => getIssues(p),
			getInitialValue: () => resolveInitialValue(canonical.segments),
			getFieldMeta: (pk) => (store.getState().fieldMeta as Record<string, FieldMetaEntry>)[pk],
			markTouched: markFieldTouched,
			getFormSubmitted: () => store.getState().meta.submitted ?? false,
			updateFieldMeta,
			formDefaults: options.fieldDefaults,
			config,
		});
		fieldCache.set(cacheKey, fieldApi);
		return fieldApi;
	}

	function reset(nextInitial?: { readonly data?: TData; readonly uiState?: TUi }): void {
		submitHandler.reset();
		validationCoordinator.reset();
		if (nextInitial?.data !== undefined) initialDataSnapshot = structuredClone(nextInitial.data);
		const resetData =
			nextInitial?.data !== undefined ? structuredClone(nextInitial.data) : structuredClone(initialDataSnapshot);
		const resetUi =
			nextInitial?.uiState !== undefined
				? structuredClone(nextInitial.uiState)
				: structuredClone(initialUiStateSnapshot);
		const tx = store.beginTransaction();
		tx.mutate(
			() =>
				({
					data: resetData,
					uiState: resetUi,
					meta: { validation: { validating: false }, submission: { status: "idle" } },
					fieldMeta: {},
					fieldPolicy: [],
					issues: [],
				}) as FormState<TData, TUi>,
		);
		store.commitTransaction(tx);
		fieldCache.clear();
		listeners.clear();
		for (const plugin of plugins) plugin.onReset?.();
	}

	const submitHandler = createSubmitHandler<TData, TUi>({
		store,
		pipelineStore,
		pipelineOptions,
		options,
		plugins,
		coordinator: validationCoordinator,
		getApi: () => api,
	});

	const api: FormApi<TData, TUi> = {
		getState: () => store.getState(),
		dispatch,
		setValue: dispatchSetValue,
		validate,
		validateAsync: validationCoordinator.validate,
		submit: submitHandler.submit,
		// Justified: runtime path validation ensures P constraint; cast bridges generic method signature
		field: field as FormApi<TData, TUi>["field"],
		fieldDynamic: field as FormApi<TData, TUi>["fieldDynamic"],
		subscribe: (listener) => store.subscribe(listener),
		reset,
		canSubmit: () => {
			const state = store.getState();
			return !computeIsSubmitting(state) && !state.meta.validation.validating && computeIsValid(state);
		},
		isPristine: () => computeIsPristine(store.getState(), initialDataSnapshot),
		isDirty: () => !computeIsPristine(store.getState(), initialDataSnapshot),
		isValid: () => computeIsValid(store.getState()),
		isSubmitting: () => computeIsSubmitting(store.getState()),
		isTouched: () => computeIsTouched(store.getState()),
		isDisposed: disposal.isDisposed,
		onDispose: disposal.onDispose,
		getDisposalDiagnostics: disposal.getDiagnostics,
		dispose: createFormDisposer(disposal, {
			abort: submitHandler.dispose,
			cancel: validationCoordinator.dispose,
			plugins,
			pluginDisposers,
			middlewares: options.middleware ?? [],
			clearFields: () => fieldCache.clear(),
			disposeStore: () => store.dispose(),
		}),
	};

	initMiddlewares((options.middleware ?? []) as readonly Middleware[], { state: initialState });

	// Initialize plugins
	for (const plugin of plugins) {
		if (!plugin.onInit) continue;
		const pluginId = plugin.id;
		const initCtx: PluginInitContext<TData, TUi> = {
			getState: () => ({
				data: store.getState().data,
				uiState: store.getState().uiState,
			}),
			subscribe: (listener) => store.subscribe((state) => listener({ data: state.data, uiState: state.uiState })),
			dispatch: (a: FormAction) => {
				dispatch({ ...a, origin: `plugin:${pluginId}` });
			},
			initialData: initialDataSnapshot,
		};
		const disposer = plugin.onInit(initCtx);
		if (disposer) pluginDisposers.push(disposer);
	}

	return api;
}
