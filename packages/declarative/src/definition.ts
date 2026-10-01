import type { StoredComputation } from "./computations.js";
import type { FormNode } from "./nodes.js";
import type { PrepareKaladaV1Options, PreparedKaladaV1Definition } from "./validators/kalada-prepared-definition.js";

export interface FormDefinition {
	readonly version: 1;
	readonly id: string;
	readonly root: FormNode;
	readonly computations?: readonly StoredComputation[];
	readonly submission?: { readonly hiddenValues: "include" | "omit-inactive" };
}

/** Validated definitions retain the host's admission proof; a JSON copy is not validated. */
export type ValidatedFormDefinition = FormDefinition & {
	readonly prepared: PreparedKaladaV1Definition;
};

export type FormDefinitionAdmission = Omit<PrepareKaladaV1Options, "definition">;
