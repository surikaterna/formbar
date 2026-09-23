import type { CanonicalPath } from "./path.js";
import type { ValidationIssue } from "./state.js";

export function pathEquals(a: CanonicalPath, b: CanonicalPath): boolean {
	return (
		a.namespace === b.namespace &&
		a.segments.length === b.segments.length &&
		a.segments.every((seg, i) => seg === b.segments[i])
	);
}

export function pathStartsWith(path: CanonicalPath, prefix: CanonicalPath): boolean {
	return (
		path.namespace === prefix.namespace &&
		path.segments.length >= prefix.segments.length &&
		prefix.segments.every((seg, i) => seg === path.segments[i])
	);
}

export function issuesForPath(issues: readonly ValidationIssue[], path: CanonicalPath): readonly ValidationIssue[] {
	return issues.filter((issue) => pathEquals(issue.path, path) || pathStartsWith(issue.path, path));
}
