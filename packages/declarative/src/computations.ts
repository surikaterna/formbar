import type { Expression, StateRef } from "@formbar/expressions";
import type { Binding } from "./bindings.js";

export interface StoredComputation {
	readonly id: string;
	readonly target: Binding;
	readonly expression: Expression;
}

export interface ValidatedComputation extends StoredComputation {
	readonly dependencies: readonly StateRef[];
}
