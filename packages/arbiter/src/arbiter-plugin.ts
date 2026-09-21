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

/**
 * Creates a FormPlugin that bridges @arbitre/core into the formbar pipeline.
 * Syncs form data into the rule session, fires rules, and converts results
 * into PluginWrite[] records.
 */
export function createArbiterPlugin(options: ArbiterPluginOptions): FormPlugin {
	const { rules, session: externalSession } = options;

	let session: RuleSession;
	let ownsSession: boolean;

	if (externalSession) {
		session = externalSession;
		ownsSession = false;
	} else if (rules) {
		session = createSession({ rules: rules as ProductionRule[] });
		ownsSession = true;
	} else {
		throw new Error("createArbiterPlugin requires either `rules` or `session`");
	}

	return {
		id: "arbiter",

		evaluate(ctx: PluginEvaluateContext): PluginEvaluateResult | undefined {
			// Prevent re-entry from own writes
			if (ctx.origin.startsWith("plugin:arbiter")) return;

			// Short-circuit when nothing relevant changed
			if (!ctx.change.dataChanged && !ctx.change.uiChanged) return;

			// Sync form data fields into the session
			const data = ctx.data as Record<string, unknown>;
			for (const key of Object.keys(data)) {
				session.assert(key, data[key]);
			}

			// Sync $ui.* state
			const uiState = ctx.uiState as Record<string, unknown>;
			for (const key of Object.keys(uiState)) {
				session.assert(`$ui.${key}`, uiState[key]);
			}

			// Fire rules
			const result: FiringResult = session.fire();

			// Convert changes to PluginWrite[], filtering internal paths
			const writes: PluginWrite[] = [];
			for (const change of result.changes) {
				if (isArbiterInternalPath(change.path)) continue;
				writes.push({
					path: change.path,
					value: change.newValue,
					mode: "set",
				});
			}

			return {
				writes: writes.length > 0 ? writes : undefined,
			};
		},

		onDispose() {
			if (ownsSession) {
				session.dispose();
			}
		},
	};
}
