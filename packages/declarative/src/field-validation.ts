import type { IssueSeverity } from "@formbar/core";
import type { Segment } from "@formbar/expressions";
import type { RuntimeNodeInstance } from "./runtime-contracts.js";

/** Input to a trusted definition-field validator; the host creates the absolute issue and its provenance. */
export interface FieldIssueInput {
	readonly code: string;
	readonly message: string;
	readonly severity: IssueSeverity;
	readonly descendant?: readonly Segment[];
}

/** Current concrete data binding; string "0" and numeric index 0 are different segments. */
export interface FieldValidationBinding {
	readonly namespace: "data";
	readonly segments: readonly Segment[];
}

export interface FieldValidationTarget {
	readonly instance: RuntimeNodeInstance;
	readonly binding: FieldValidationBinding;
}
