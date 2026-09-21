import type { FormAction, Middleware, ValidatorFn } from "./contracts.js";
import { FormbarError } from "./errors.js";
import { applyRuleWrites } from "./expression-integration.js";
import {
	fieldMetaKey,
	normalizeDataPath,
	normalizePolicySnapshot,
	replacePolicyContributions,
} from "./field-policy.js";
import { setImmutablePath } from "./immutable-path.js";
import { runNotifyHooksSync, runVetoHooksSync } from "./middleware-runner.js";
import { parsePath } from "./path-parser.js";
import type { FormPlugin, PluginChangeDescriptor, PluginEvaluateContext, PluginWrite } from "./plugin-types.js";
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

const PIPELINE_ISSUE_ORIGINS = new Set<ValidationIssue["source"]["origin"]>([
	"standard-schema",
	"function-validator",
	"json-schema-adapter",
]);

function mergePipelineIssues(
	current: readonly ValidationIssue[],
	next: readonly ValidationIssue[],
	hasValidators: boolean,
): readonly ValidationIssue[] {
	if (!hasValidators) return current;
	return normalizeIssues([...current.filter((issue) => !PIPELINE_ISSUE_ORIGINS.has(issue.source.origin)), ...next]);
}

function pluginOrigin(action: FormAction): PluginEvaluateContext["origin"] {
	if (action.origin?.startsWith("plugin:")) return action.origin as `plugin:${string}`;
	if (action.type === "reset") return "reset";
	if (action.type === "init") return "init";
	return "user";
}

function createPluginContext(
	action: FormAction,
	draftState: { readonly data: unknown; readonly uiState: unknown; readonly issues: readonly ValidationIssue[] },
	prevState: { readonly data: unknown; readonly uiState: unknown },
): PluginEvaluateContext {
	const change: PluginChangeDescriptor = {
		path: action.path,
		type: action.type,
		dataChanged: draftState.data !== prevState.data,
		uiChanged: draftState.uiState !== prevState.uiState,
	};
	return {
		action,
		data: draftState.data as Readonly<unknown>,
		uiState: draftState.uiState as Readonly<unknown>,
		prevData: prevState.data as Readonly<unknown>,
		prevUiState: prevState.uiState as Readonly<unknown>,
		change,
		issues: draftState.issues,
		origin: pluginOrigin(action),
		getValueAtPath: (path) => getValueAtPath(draftState.data, path),
	};
}

function evaluatePlugins(
	plugins: readonly FormPlugin[],
	action: FormAction,
	draftState: { readonly data: unknown; readonly uiState: unknown; readonly issues: readonly ValidationIssue[] },
	prevState: { readonly data: unknown; readonly uiState: unknown },
): {
	writes: readonly PluginWrite[];
	policyReplacements: ReadonlyMap<string, ReturnType<typeof normalizePolicySnapshot>>;
} {
	const allWrites: PluginWrite[] = [];
	const policyReplacements = new Map<string, ReturnType<typeof normalizePolicySnapshot>>();
	const context = createPluginContext(action, draftState, prevState);
	for (const plugin of plugins) {
		if (!plugin.evaluate) continue;
		const result = plugin.evaluate(context);
		if (!result) continue;
		if (result.writes) allWrites.push(...result.writes);
		if (result.fieldPolicy !== undefined) {
			policyReplacements.set(plugin.id, normalizePolicySnapshot(plugin.id, result.fieldPolicy));
		}
	}

	return { writes: allWrites, policyReplacements };
}

function transformActionValue(
	action: FormAction,
	options: CreateFormOptions<unknown, unknown>,
	state: import("./state.js").FormState<unknown, unknown>,
): unknown {
	if (action.path === undefined || action.value === undefined) return action.value;
	const transforms = getTransformDefs(options);
	if (transforms.length === 0) return action.value;
	const path = parsePath(action.path).segments.join(".");
	const ingress = runTransforms(transforms, "ingress", action.value, { path, state });
	return runTransforms(transforms, "field", ingress, { path, state });
}

function markActionFieldTouched(tx: Transaction<unknown, unknown>, path: ReturnType<typeof parsePath>): void {
	if (path.namespace !== "data") return;
	const pathKey = fieldMetaKey(normalizeDataPath({ namespace: "data", segments: path.segments }));
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

function applyBaseMutation(ctx: PipelineContext, tx: Transaction<unknown, unknown>): void {
	const { action } = ctx;
	if (action.type !== "set-value" || action.path === undefined) return;
	const path = parsePath(action.path);
	const value = transformActionValue(action, ctx.options, tx.draftState);
	tx.mutate((draft) =>
		path.namespace === "ui"
			? { ...draft, uiState: setImmutablePath(draft.uiState, path.segments, value) }
			: { ...draft, data: setImmutablePath(draft.data, path.segments, value) },
	);
	markActionFieldTouched(tx, path);
}

function runPluginPhase(
	ctx: PipelineContext,
	tx: Transaction<unknown, unknown>,
	previousPolicy: import("./state.js").FormState<unknown, unknown>["fieldPolicy"],
): import("./state.js").FormState<unknown, unknown>["fieldPolicy"] {
	const plugins = ctx.plugins ?? [];
	if (plugins.length === 0) return previousPolicy;
	const result = evaluatePlugins(plugins, ctx.action, tx.draftState, tx.prevState);
	if (result.writes.length > 0) tx.mutate((draft) => applyRuleWrites(draft, result.writes));
	return result.policyReplacements.size > 0
		? replacePolicyContributions(previousPolicy, plugins, result.policyReplacements)
		: previousPolicy;
}

function runValidationPhase(
	ctx: PipelineContext,
	tx: Transaction<unknown, unknown>,
	middlewares: readonly Middleware[],
): readonly ValidationIssue[] {
	const stage = tx.draftState.meta.stage;
	runNotifyHooksSync(middlewares, "beforeValidate", {
		action: ctx.action,
		state: tx.draftState,
		...(stage !== undefined ? { stage } : {}),
	});
	const raw = ctx.options.validators?.length
		? runValidators(ctx.options.validators as readonly ValidatorFn[], tx.draftState, stage, ctx.submitContext)
		: [];
	const issues = normalizeIssues(raw);
	runNotifyHooksSync(middlewares, "afterValidate", { action: ctx.action, state: tx.draftState, issues });
	return issues;
}

function submitVeto(ctx: PipelineContext, tx: Transaction<unknown, unknown>, middlewares: readonly Middleware[]) {
	if (!ctx.isSubmit || !ctx.submitContext) return;
	const decision = runVetoHooksSync(middlewares, "beforeSubmit", {
		action: ctx.action,
		state: tx.draftState,
		submitContext: ctx.submitContext,
	});
	return decision.action === "veto" ? decision.reason : undefined;
}

function executeTransaction(
	ctx: PipelineContext,
	tx: Transaction<unknown, unknown>,
	previousPolicy: import("./state.js").FormState<unknown, unknown>["fieldPolicy"],
): PipelineResult {
	const middlewares = (ctx.options.middleware ?? []) as readonly Middleware[];
	const before = runVetoHooksSync(middlewares, "beforeAction", { action: ctx.action, state: tx.prevState });
	if (before.action === "veto") return { ok: false, vetoed: true, vetoReason: before.reason };
	applyBaseMutation(ctx, tx);
	runNotifyHooksSync(middlewares, "beforeEvaluate", { action: ctx.action, state: tx.draftState });
	const fieldPolicy = runPluginPhase(ctx, tx, previousPolicy);
	runNotifyHooksSync(middlewares, "afterEvaluate", { action: ctx.action, state: tx.draftState });
	const issues = runValidationPhase(ctx, tx, middlewares);
	const vetoReason = submitVeto(ctx, tx, middlewares);
	if (vetoReason) return { ok: false, vetoed: true, vetoReason };
	tx.mutate((draft) => ({
		...draft,
		fieldPolicy,
		issues: mergePipelineIssues(draft.issues, issues, Boolean(ctx.options.validators?.length)),
	}));
	ctx.store.commitTransaction(tx);
	runNotifyHooksSync(middlewares, "afterAction", {
		action: ctx.action,
		prevState: tx.prevState,
		nextState: ctx.store.getState(),
	});
	return { ok: true, issues: ctx.store.getState().issues };
}

function rollback(store: FormStore<unknown, unknown>, tx: Transaction<unknown, unknown>): void {
	try {
		if (tx.status === "active") store.rollbackTransaction(tx);
	} catch {
		// The original pipeline failure remains authoritative.
	}
}

/**
 * Executes the 18-step transactional pipeline for a form action.
 * All-or-nothing semantics: partial commits never occur.
 */
export function executePipeline(ctx: PipelineContext): PipelineResult {
	let tx: Transaction<unknown, unknown> | undefined;
	try {
		if (ctx.action.path !== undefined) {
			parsePath(ctx.action.path);
		}
		const previousPolicy = ctx.store.getState().fieldPolicy;
		tx = ctx.store.beginTransaction();
		const result = executeTransaction(ctx, tx, previousPolicy);
		if (!result.ok) rollback(ctx.store, tx);
		return result;
	} catch (err) {
		if (tx) rollback(ctx.store, tx);
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}
