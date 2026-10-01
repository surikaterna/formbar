import type { StateRef } from "@formbar/expressions";
import type { Binding } from "./bindings.js";
import type { DefinitionProgram } from "./nodes.js";

export interface StoredComputation {
	readonly id: string;
	readonly target: Binding;
	readonly expression: DefinitionProgram;
}

export interface ValidatedComputation extends StoredComputation {
	readonly dependencies: readonly StateRef[];
}
