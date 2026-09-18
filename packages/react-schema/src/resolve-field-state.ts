import {
	DEFAULT_FIELD_STATE,
	descriptionId,
	errorId,
	fieldId,
	pruneHiddenFields,
	resolveFieldStates as resolveSharedFieldStates,
} from "@formbar/from-schema";
import type { ResolvedFieldState } from "@formbar/from-schema";

export type { ResolvedFieldState } from "@formbar/from-schema";
export { DEFAULT_FIELD_STATE, descriptionId, errorId, fieldId, pruneHiddenFields };

/**
 * Build a map of field path → resolved UI state from the arbiter uiState object.
 * Convention: arbiter writes to `$ui.<path>.visible`, `$ui.<path>.readOnly`, `$ui.<path>.disabled`.
 * The uiState on FormState already strips the `$ui.` prefix, so keys are `<path>.visible` etc.
 */
export function resolveFieldStates(
	uiState: Readonly<Record<string, unknown>>,
	fieldPaths: readonly string[],
): ReadonlyMap<string, ResolvedFieldState> {
	return resolveSharedFieldStates(uiState, fieldPaths);
}
