import type { ScopedForeground } from "./scoped-async-scheduler.js";
import type { ValidationIssue } from "./state.js";
import { normalizeIssues } from "./validation.js";

/** Stage ownership before notifying listeners, and undo only an uncommitted publication. */
export function publishScopedForeground(
	foreground: ScopedForeground,
	legacyIds: ReadonlySet<string>,
	legacy: readonly ValidationIssue[],
	scoped: readonly ValidationIssue[],
	publish: (
		ids: ReadonlySet<string>,
		previous: ReadonlySet<ValidationIssue>,
		issues: readonly ValidationIssue[],
	) => void,
): readonly ValidationIssue[] {
	const issues = normalizeIssues([...legacy, ...scoped]);
	const staged = foreground.stage();
	try {
		publish(legacyIds, staged.previous, issues);
		staged.finish();
	} catch (error) {
		staged.rollback();
		throw error;
	}
	return issues;
}

export function publishCoordinatorForeground(
	foreground: ScopedForeground | undefined,
	ids: ReadonlySet<string>,
	legacy: readonly ValidationIssue[],
	scoped: readonly ValidationIssue[],
	replaceLegacy: (ids: ReadonlySet<string>, issues: readonly ValidationIssue[]) => void,
	publishScoped?: (
		ids: ReadonlySet<string>,
		previous: ReadonlySet<ValidationIssue>,
		issues: readonly ValidationIssue[],
	) => void,
): readonly ValidationIssue[] {
	if (foreground) {
		if (!publishScoped) throw new Error("Missing trusted scoped async issue publisher");
		return publishScopedForeground(foreground, ids, legacy, scoped, publishScoped);
	}
	const issues = normalizeIssues(legacy);
	replaceLegacy(ids, issues);
	return issues;
}
