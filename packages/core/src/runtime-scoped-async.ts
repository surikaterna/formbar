import type { FormApi } from "./contracts.js";
import { ScopedAsyncScheduler } from "./scoped-async-scheduler.js";
import type { ValidationIssue } from "./state.js";
import { type FormStore, publishIssueOnly, snapshotOwnership } from "./store.js";
import { normalizeIssues } from "./validation.js";

/** Runtime adapter: scoped completions only use trusted issue-only publication. */
export function createRuntimeScopedAsync<TData, TUi>(
	form: () => FormApi<TData, TUi>,
	store: FormStore<TData, TUi>,
	timeout?: number,
): ScopedAsyncScheduler<TData, TUi> {
	return new ScopedAsyncScheduler({
		form,
		revision: () => snapshotOwnership(store.getState())?.write ?? -1,
		...(timeout === undefined ? {} : { timeout }),
		publishIssues(previous, issues) {
			const retained = store.getState().issues.filter((issue) => !previous.has(issue));
			publishIssueOnly(store, normalizeIssues([...retained, ...issues]));
		},
	});
}

/** Single owned commit replaces selected legacy IDs and only scoped originals from selected instances. */
export function publishRuntimeScopedForeground<TData, TUi>(
	store: FormStore<TData, TUi>,
	legacyIds: ReadonlySet<string>,
	previous: ReadonlySet<ValidationIssue>,
	issues: readonly ValidationIssue[],
): void {
	const retained = store
		.getState()
		.issues.filter(
			(issue) =>
				!previous.has(issue) && (issue.source.origin !== "async-validator" || !legacyIds.has(issue.source.validatorId)),
		);
	publishIssueOnly(store, normalizeIssues([...retained, ...issues]));
}
