import type { StoredComputation } from "./computations.js";
import type { FormNode } from "./nodes.js";

export interface FormDefinition {
	readonly version: 1;
	readonly id: string;
	readonly root: FormNode;
	readonly computations?: readonly StoredComputation[];
}

export type ValidatedFormDefinition = FormDefinition;
