import type { StateRef } from "@formbar/expressions";
import type { ActionNode } from "./nodes.js";
import type { ResolvedActionState, ResolvedNodeState, RuntimeDiagnostic } from "./runtime-contracts.js";
import { runtimeDiagnostic } from "./runtime-diagnostics.js";
import { type RuntimeExpressionFrame, evaluateRuntimeExpression } from "./runtime-expressions.js";

export interface ResolveActionStateOptions {
	readonly node: ActionNode;
	readonly nodeState: ResolvedNodeState;
	readonly target?: StateRef;
	readonly frame: RuntimeExpressionFrame;
	readonly diagnostics: RuntimeDiagnostic[];
}

export function resolveActionState(options: ResolveActionStateOptions): ResolvedActionState {
	const payload = resolvePayload(options);
	const target =
		options.target?.namespace === "data"
			? Object.freeze({ namespace: "data" as const, segments: options.target.segments })
			: undefined;
	return Object.freeze({
		...options.nodeState,
		type: "action",
		action: options.node.action,
		concurrency: options.node.concurrency ?? "drop",
		payload,
		...(target ? { target } : {}),
	});
}

function resolvePayload(options: ResolveActionStateOptions): ResolvedActionState["payload"] {
	if (!options.node.payload) return Object.freeze({ status: "absent" });
	const result = evaluateRuntimeExpression(options.frame, options.node.payload);
	if (result.ok) return Object.freeze({ status: "ready", value: result.value });
	const code = result.diagnostics[0]?.code ?? "backend";
	options.diagnostics.push(runtimeDiagnostic("expression", options.nodeState.instance, "payload", code));
	return Object.freeze({ status: "error", code });
}
