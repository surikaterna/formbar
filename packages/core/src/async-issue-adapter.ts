import { normalizeDataPath } from "./field-policy.js";
import type { AbsoluteDataPath } from "./field-policy.js";
import { issueEmissionId } from "./issue-provenance.js";
import type { ValidationIssue } from "./state.js";

export function canonicalizeIssue(
	issue: ValidationIssue,
	validatorId: string,
	preserveCertified = false,
): ValidationIssue {
	const path =
		issue.path.namespace === "data" && issue.path.segments.length > 0
			? normalizeDataPath({ namespace: "data", segments: issue.path.segments })
			: issue.path;
	if (
		preserveCertified &&
		issueEmissionId(issue) !== undefined &&
		issue.source.origin === "function-validator" &&
		issue.source.validatorId === validatorId &&
		path.segments.length === issue.path.segments.length &&
		path.segments.every((segment, index) => segment === issue.path.segments[index])
	)
		return issue;
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

/** Automatic callbacks have no caller to receive a rejection; report only a safe code. */
export function automaticFailureIssue(validator: {
	readonly config: { readonly id: string };
	readonly fields: readonly AbsoluteDataPath[];
}): ValidationIssue {
	return {
		code: "ASYNC_VALIDATOR_EXCEPTION",
		message: "ISSUE_ONLY_UNSUPPORTED_STATE",
		severity: "error",
		path: validator.fields[0] ?? { namespace: "data", segments: [] },
		source: { origin: "async-validator", validatorId: validator.config.id },
	};
}
