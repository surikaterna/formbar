import { normalizeDataPath } from "./field-policy.js";
import type { AbsoluteDataPath } from "./field-policy.js";
import type { ValidationIssue } from "./state.js";

export function canonicalizeIssue(issue: ValidationIssue, validatorId: string): ValidationIssue {
	const path =
		issue.path.namespace === "data" && issue.path.segments.length > 0
			? normalizeDataPath({ namespace: "data", segments: issue.path.segments })
			: issue.path;
	return {
		...issue,
		path: { ...issue.path, ...path },
		source: { ...issue.source, origin: "async-validator", validatorId },
	};
}

export function exceptionIssue(
	validator: { readonly config: { readonly id: string }; readonly fields: readonly AbsoluteDataPath[] },
	error: unknown,
): ValidationIssue {
	return {
		code: "ASYNC_VALIDATOR_EXCEPTION",
		message: error instanceof Error ? error.message : String(error),
		severity: "error",
		path: validator.fields[0] ?? { namespace: "data", segments: [] },
		source: { origin: "async-validator", validatorId: validator.config.id },
	};
}
