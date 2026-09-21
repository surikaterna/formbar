import { createSession } from "@arbitre/core";
import type { FiringResult, ProductionRule, RuleSession } from "@arbitre/core";
import type { FormPlugin, PluginEvaluateContext, PluginEvaluateResult, PluginWrite } from "@formbar/core";
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

function syncSession(session: RuleSession, ctx: PluginEvaluateContext): void {
	const data = ctx.data as Record<string, unknown>;
	for (const key of Object.keys(data)) session.assert(key, data[key]);
	const uiState = ctx.uiState as Record<string, unknown>;
	for (const key of Object.keys(uiState)) session.assert(`$ui.${key}`, uiState[key]);
}

function toWrites(result: FiringResult): readonly PluginWrite[] {
	return result.changes
		.filter((change) => !isArbiterInternalPath(change.path))
		.map((change) => ({ path: change.path, value: change.newValue, mode: "set" as const }));
}

function evaluateSession(session: RuleSession, ctx: PluginEvaluateContext): PluginEvaluateResult | undefined {
	if (ctx.origin.startsWith("plugin:arbiter")) return;
	if (!ctx.change.dataChanged && !ctx.change.uiChanged) return;
	syncSession(session, ctx);
	const writes = toWrites(session.fire());
	return { writes: writes.length > 0 ? writes : undefined };
}

/**
 * Creates a FormPlugin that bridges @arbitre/core into the formbar pipeline.
 * Syncs form data into the rule session, fires rules, and converts results
 * into PluginWrite[] records.
 */
export function createArbiterPlugin(options: ArbiterPluginOptions): FormPlugin {
	const { session, owned } = resolveSession(options);
	return {
		id: "arbiter",
		evaluate: (ctx) => evaluateSession(session, ctx),
		onDispose() {
			if (owned) session.dispose();
		},
	};
}
