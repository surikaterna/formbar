import type { StoredComputation } from "./computations.js";
import type { FormNode } from "./nodes.js";

export interface FormDefinition {
	readonly version: 1;
	readonly id: string;
	readonly root: FormNode;
	readonly computations?: readonly StoredComputation[];
	readonly submission?: { readonly hiddenValues: "include" | "omit-inactive" };
}

export type ValidatedFormDefinition = FormDefinition;
