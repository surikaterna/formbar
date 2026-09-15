import type { FormAction, Middleware, ValidatorFn } from "./contracts.js";
import { FormbarError } from "./errors.js";
import { applyRuleWrites } from "./expression-integration.js";
import { setImmutablePath } from "./immutable-path.js";
import { runNotifyHooksSync, runVetoHooksSync } from "./middleware-runner.js";
import { parsePath } from "./path-parser.js";
import type {
	FormPlugin,
	PluginChangeDescriptor,
	PluginEvaluateContext,
	PluginFieldMeta,
	PluginWrite,
} from "./plugin-types.js";
import type { CreateFormOptions, FieldMetaEntry, SubmitContext, ValidationIssue } from "./state.js";
import type { FormStore } from "./store.js";
import type { Transaction } from "./transaction.js";
import type { TransformDefinition } from "./transforms.js";
import { runTransforms } from "./transforms.js";
import { normalizeIssues } from "./validation.js";

/** Resolve a value from a nested object by dot-path traversal */
function getValueAtPath(root: unknown, path: string): unknown {
	const segments = path.split(".");
	let current: unknown = root;
	for (const seg of segments) {
		if (current === null || current === undefined) return undefined;
		current = (current as Record<string, unknown>)[seg];
	}
	return current;
}

/** Pipeline context — everything the 18-step engine needs */
export interface PipelineContext {
	readonly action: FormAction;
	readonly store: FormStore<unknown, unknown>;
	readonly options: CreateFormOptions<unknown, unknown>;
	readonly submitContext?: SubmitContext;
	readonly isSubmit: boolean;
	readonly plugins?: readonly FormPlugin[];
}

/** Pipeline result — outcome of the 18-step execution */
export interface PipelineResult {
	readonly ok: boolean;
	readonly error?: string;
	readonly vetoed?: boolean;
	readonly vetoReason?: string;
	readonly issues?: readonly ValidationIssue[];
	readonly pluginFieldMeta?: Readonly<Record<string, PluginFieldMeta>>;
}

/** Resolve TransformDefinitions from options.transforms (duck-type check) */
function getTransformDefs(options: CreateFormOptions<unknown, unknown>): readonly TransformDefinition[] {
	if (!options.transforms?.length) return [];
	return options.transforms.filter(
		(t): t is TransformDefinition => "transform" in t && typeof (t as TransformDefinition).transform === "function",
	);
}

/** Run validators synchronously; throws FORMBAR_ASYNC_IN_SYNC_PIPELINE if one returns a Promise */
function runValidators(
	validators: readonly ValidatorFn[],
	state: { readonly data: unknown; readonly uiState: unknown; readonly meta: { readonly stage?: string } },
	stage: string | undefined,
	submitContext?: SubmitContext,
): readonly ValidationIssue[] {
	const allIssues: ValidationIssue[] = [];
	for (const v of validators) {
		const base = { data: state.data, uiState: state.uiState };
		const withStage = stage !== undefined ? { ...base, stage } : base;
		const input = submitContext ? { ...withStage, context: submitContext } : withStage;
		const result = v(input);
		if (result instanceof Promise) {
			throw new FormbarError(
				"FORMBAR_ASYNC_IN_SYNC_PIPELINE",
				"Validator returned a Promise in synchronous pipeline — use async submit path",
			);
		}
		allIssues.push(...result);
	}
	return allIssues;
}

/** Evaluate all plugins and return collected writes and merged fieldMeta */
function evaluatePlugins(
	plugins: readonly FormPlugin[],
	action: FormAction,
	draftState: { readonly data: unknown; readonly uiState: unknown; readonly issues: readonly ValidationIssue[] },
	prevState: { readonly data: unknown; readonly uiState: unknown },
): { writes: readonly PluginWrite[]; fieldMeta: Record<string, PluginFieldMeta> } {
	const allWrites: PluginWrite[] = [];
	const mergedFieldMeta: Record<string, PluginFieldMeta> = {};

	const change: PluginChangeDescriptor = {
		path: action.path,
		type: action.type,
		dataChanged: draftState.data !== prevState.data,
		uiChanged: draftState.uiState !== prevState.uiState,
	};

	const origin: PluginEvaluateContext["origin"] = action.origin?.startsWith("plugin:")
		? (action.origin as `plugin:${string}`)
		: action.type === "reset"
			? "reset"
			: action.type === "init"
				? "init"
				: "user";

	const ctx: PluginEvaluateContext = {
		action,
		data: draftState.data as Readonly<unknown>,
		uiState: draftState.uiState as Readonly<unknown>,
		prevData: prevState.data as Readonly<unknown>,
		prevUiState: prevState.uiState as Readonly<unknown>,
		change,
		issues: draftState.issues,
		origin,
		getValueAtPath: (path: string) => getValueAtPath(draftState.data, path),
	};

	for (const plugin of plugins) {
		if (!plugin.evaluate) continue;
		const result = plugin.evaluate(ctx);
		if (!result) continue;
		if (result.writes) allWrites.push(...result.writes);
		if (result.fieldMeta) {
			for (const [path, meta] of Object.entries(result.fieldMeta)) {
				mergedFieldMeta[path] = mergedFieldMeta[path] ? { ...mergedFieldMeta[path], ...meta } : meta;
			}
		}
	}

	return { writes: allWrites, fieldMeta: mergedFieldMeta };
}

/**
 * Executes the 18-step transactional pipeline for a form action.
 * All-or-nothing semantics: partial commits never occur.
 */
export function executePipeline(ctx: PipelineContext): PipelineResult {
	const { action, store, options, submitContext, isSubmit } = ctx;
	const middlewares = (options.middleware ?? []) as readonly Middleware[];
	const plugins = ctx.plugins ?? [];

	// Step 1: Normalize input — parse/validate path
	if (action.path !== undefined) {
		try {
			parsePath(action.path);
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : String(err) };
		}
	}

	// Step 2: Begin transaction — capture immutable prevState snapshot
	let tx: Transaction<unknown, unknown> | undefined;
	try {
		tx = store.beginTransaction();
		const prevState = tx.prevState;

		// Step 3: Middleware beforeAction — MAY veto
		const beforeActionDecision = runVetoHooksSync(middlewares, "beforeAction", { action, state: prevState });
		if (beforeActionDecision.action === "veto") {
			store.rollbackTransaction(tx);
			return { ok: false, vetoed: true, vetoReason: (beforeActionDecision as { reason: string }).reason };
		}

		// Step 4: Apply ingress/field transforms
		let transformedValue = action.value;
		if (action.path !== undefined && transformedValue !== undefined) {
			const transformDefs = getTransformDefs(options);
			if (transformDefs.length > 0) {
				const canonical = parsePath(action.path);
				const pathStr = canonical.segments.join(".");
				transformedValue = runTransforms(transformDefs, "ingress", transformedValue, {
					path: pathStr,
					state: tx.draftState,
				});
				transformedValue = runTransforms(transformDefs, "field", transformedValue, {
					path: pathStr,
					state: tx.draftState,
				});
			}
		}

		// Step 5: Apply base mutation
		if (action.type === "set-value" && action.path !== undefined) {
			const canonical = parsePath(action.path);
			tx.mutate((draft) => {
				if (canonical.namespace === "ui") {
					return { ...draft, uiState: setImmutablePath(draft.uiState, canonical.segments, transformedValue) };
				}
				return { ...draft, data: setImmutablePath(draft.data, canonical.segments, transformedValue) };
			});

			// Mark field as touched for data-namespace paths (transactional — rolled back on failure)
			if (canonical.namespace === "data") {
				const pathKey = canonical.segments.join(".");
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
								dirty: true,
								listenerTriggered: existing?.listenerTriggered ?? false,
							},
						},
					};
				});
			}
		}

		// Step 6: Middleware beforeEvaluate
		runNotifyHooksSync(middlewares, "beforeEvaluate", { action, state: tx.draftState });

		// Step 7: Evaluate plugins
		let pluginFieldMeta: Record<string, PluginFieldMeta> = {};
		if (plugins.length > 0) {
			const { writes, fieldMeta } = evaluatePlugins(plugins, action, tx.draftState, prevState);
			pluginFieldMeta = fieldMeta;
			if (writes.length > 0) {
				tx.mutate((draft) => applyRuleWrites(draft, writes));
			}
		}

		// Step 8: Middleware afterEvaluate
		runNotifyHooksSync(middlewares, "afterEvaluate", { action, state: tx.draftState });

		// Step 9: Resolve active validation stage (optional — from meta.stage)
		const activeStage = tx.draftState.meta.stage;

		// Step 10: Middleware beforeValidate
		runNotifyHooksSync(middlewares, "beforeValidate", {
			action,
			state: tx.draftState,
			...(activeStage !== undefined ? { stage: activeStage } : {}),
		});

		// Step 11: Run validators and normalize to issue envelope
		let issues: readonly ValidationIssue[] = [];
		if (options.validators?.length) {
			const rawIssues = runValidators(
				options.validators as readonly ValidatorFn[],
				tx.draftState,
				activeStage,
				submitContext,
			);
			issues = normalizeIssues(rawIssues);
		}

		// Step 12: Middleware afterValidate
		runNotifyHooksSync(middlewares, "afterValidate", { action, state: tx.draftState, issues });

		// Step 13: If submit action — run beforeSubmit; MAY veto
		if (isSubmit && submitContext) {
			const beforeSubmitDecision = runVetoHooksSync(middlewares, "beforeSubmit", {
				action,
				state: tx.draftState,
				submitContext,
			});
			if (beforeSubmitDecision.action === "veto") {
				store.rollbackTransaction(tx);
				return { ok: false, vetoed: true, vetoReason: (beforeSubmitDecision as { reason: string }).reason };
			}
		}

		// Step 14: Abort gate — if a fatal runtime error occurs, rollback (handled by catch)
		// Write issues into draft (always update to clear stale issues from previous dispatches)
		tx.mutate((draft) => ({ ...draft, issues }));

		// Step 15: Commit atomically
		store.commitTransaction(tx);

		// Step 16: Notify subscribers/selectors (handled by store.commitTransaction)

		// Step 17: Middleware afterAction
		const nextState = store.getState();
		runNotifyHooksSync(middlewares, "afterAction", { action, prevState, nextState });

		return { ok: true, issues, pluginFieldMeta };
	} catch (err) {
		// Step 14: Abort gate — rollback full transaction on fatal error
		try {
			if (tx) store.rollbackTransaction(tx);
		} catch {
			// Transaction may already be rolled back or never started
		}
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}
