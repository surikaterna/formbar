import { createSession } from "@arbitre/core";
import type { FiringResult, ProductionRule, RuleSession } from "@arbitre/core";
import type { FormPlugin, PluginEvaluateContext, PluginEvaluateResult, PluginWrite } from "@formbar/core";
import { readFieldPolicyOutput } from "./field-policy-output.js";
import { isArbiterInternalPath } from "./internal-paths.js";

export interface ArbiterPluginOptions {
	/** Provide raw rules — a session will be created internally. */
	readonly rules?: readonly ProductionRule[];
	/** Provide a pre-configured session instead of raw rules. */
	readonly session?: RuleSession;
}

function resolveSession(options: ArbiterPluginOptions): { session: RuleSession; owned: boolean } {
	if (options.session) return { session: options.session, owned: false };
	if (options.rules) return { session: createSession({ rules: options.rules as ProductionRule[] }), owned: true };
	throw new Error("createArbiterPlugin requires either `rules` or `session`");
}

interface SynchronizedRoots {
	data: Set<string>;
	ui: Set<string>;
}

function syncRoots(
	session: RuleSession,
	values: Record<string, unknown>,
	previous: Set<string>,
	prefix: string,
): Set<string> {
	const current = new Set(Object.keys(values));
	for (const key of previous) {
		if (!current.has(key)) session.retract(`${prefix}${key}`);
	}
	for (const key of current) session.assert(`${prefix}${key}`, values[key]);
	return current;
}

function syncSession(session: RuleSession, ctx: PluginEvaluateContext, roots: SynchronizedRoots): void {
	roots.data = syncRoots(session, ctx.data as Record<string, unknown>, roots.data, "");
	roots.ui = syncRoots(session, ctx.uiState as Record<string, unknown>, roots.ui, "$ui.");
}

function toWrites(result: FiringResult): readonly PluginWrite[] {
	return result.changes
		.filter((change) => !isArbiterInternalPath(change.path))
		.map((change) => ({ path: change.path, value: change.newValue, mode: "set" as const }));
}

function evaluateSession(
	session: RuleSession,
	ctx: PluginEvaluateContext,
	roots: SynchronizedRoots,
): PluginEvaluateResult | undefined {
	if (ctx.origin.startsWith("plugin:arbiter")) return;
	if (!ctx.change.dataChanged && !ctx.change.uiChanged) return;
	syncSession(session, ctx, roots);
	const writes = toWrites(session.fire());
	return { writes: writes.length > 0 ? writes : undefined, fieldPolicy: readFieldPolicyOutput(session) };
}

/**
 * Creates a FormPlugin that bridges @arbitre/core into the formbar pipeline.
 * Syncs form data into the rule session, fires rules, and converts results
 * into PluginWrite[] records.
 */
export function createArbiterPlugin(options: ArbiterPluginOptions): FormPlugin {
	const { session, owned } = resolveSession(options);
	const roots: SynchronizedRoots = { data: new Set(), ui: new Set() };
	return {
		id: "arbiter",
		evaluate: (ctx) => evaluateSession(session, ctx, roots),
		onDispose() {
			if (owned) session.dispose();
		},
	};
}
