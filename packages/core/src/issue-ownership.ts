import { type Node, inspect, materialize } from "./owned-issue-snapshot.js";
import type { ValidationIssue } from "./state.js";

const owned = new WeakSet<object>();
const origins = new Set([
	"standard-schema",
	"function-validator",
	"json-schema-adapter",
	"rule",
	"middleware",
	"async-validator",
	"submit",
]);

function valid(issue: ValidationIssue): boolean {
	if (
		typeof issue.code !== "string" ||
		typeof issue.message !== "string" ||
		!["error", "warning", "info"].includes(issue.severity) ||
		(issue.stage !== undefined && typeof issue.stage !== "string")
	)
		return false;
	if (!issue.path || !["data", "ui"].includes(issue.path.namespace) || !Array.isArray(issue.path.segments))
		return false;
	if (
		!issue.path.segments.every(
			(segment) =>
				typeof segment === "string" || (typeof segment === "number" && Number.isSafeInteger(segment) && segment >= 0),
		)
	)
		return false;
	if (!issue.source || !origins.has(issue.source.origin) || typeof issue.source.validatorId !== "string") return false;
	if (issue.source.adapterId !== undefined && typeof issue.source.adapterId !== "string") return false;
	if (issue.source.ruleId !== undefined && typeof issue.source.ruleId !== "string") return false;
	return (
		issue.details === undefined ||
		(!!issue.details && typeof issue.details === "object" && !Array.isArray(issue.details))
	);
}

export function isOwnedIssue(issue: ValidationIssue): boolean {
	return typeof issue === "object" && issue !== null && owned.has(issue);
}

/** Only the core can mark a detached issue; ownership never follows a structural copy. */
export function ownIssue(issue: ValidationIssue): ValidationIssue {
	return ownIssues([issue])[0] as ValidationIssue;
}

/** Inspect the complete input before freezing any newly created issue. */
export function ownIssues(issues: readonly ValidationIssue[]): readonly ValidationIssue[] {
	const plan = inspect(issues, new Set(), { value: 0 }, 0);
	const nodes = (plan as { children: [string, Node][] }).children;
	const result = issues.map((issue, index) => {
		if (isOwnedIssue(issue)) return issue;
		const node = nodes[index]?.[1];
		if (!node) throw new Error("ISSUE_ONLY_UNSUPPORTED_STATE");
		const copy = materialize(node) as ValidationIssue;
		if (!valid(copy)) throw new Error("ISSUE_ONLY_UNSUPPORTED_STATE");
		owned.add(copy);
		return copy;
	});
	return Object.freeze(result);
}
