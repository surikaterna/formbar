import type { Expression, JsonValue } from "@formbar/expressions";
import type { RuntimePort, RuntimeSnapshot } from "./runtime-contracts.js";

export interface ActionDeclaration {
	readonly id: string;
	readonly action: string;
	readonly condition?: Expression;
	readonly payload?: Expression;
}

export interface ActionRequest {
	readonly action: string;
	readonly nodeId: string;
	readonly payload?: JsonValue;
}

export interface ActionContext {
	readonly runtime: RuntimePort;
	readonly snapshot: RuntimeSnapshot;
}

export type ActionHandler = (request: ActionRequest, context: ActionContext) => void | Promise<void>;
