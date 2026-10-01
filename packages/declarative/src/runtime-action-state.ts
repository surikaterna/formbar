import type { StateRef } from "@formbar/expressions";
import type { ActionNode } from "./nodes.js";
import type {
	ResolvedActionState,
	ResolvedArrayLimits,
	ResolvedNodeState,
	RuntimeDiagnostic,
} from "./runtime-contracts.js";
import type { RuntimeExpressionFrame } from "./runtime-expressions.js";
import { ProgramAdmissionError } from "./validators/kalada-program.js";

export interface ResolveActionStateOptions {
	readonly node: ActionNode;
	readonly nodeState: ResolvedNodeState;
	readonly target?: StateRef;
	readonly arrayLimits?: ResolvedArrayLimits;
	readonly frame: RuntimeExpressionFrame;
	readonly diagnostics: RuntimeDiagnostic[];
}

/** Actions have no positional-host evaluator or writer in Kalada V1. */
export function resolveActionState(_options: ResolveActionStateOptions): ResolvedActionState {
	throw new ProgramAdmissionError("root.action", "UNSUPPORTED_V1_RE-AUTHOR");
}
