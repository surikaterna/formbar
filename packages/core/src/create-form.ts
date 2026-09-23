import type { FormApi } from "./contracts.js";
import { FormRuntime } from "./form-runtime.js";
import type { CreateFormOptions } from "./state.js";

/**
 * Creates a fully-configured form instance with transactional state management,
 * validation pipeline, and optional plugin integration.
 *
 * @param options - Configuration for data, validation, middleware, transforms, and plugins.
 * @returns A form API for state access, field manipulation, validation, and submission.
 *
 * @example
 * ```typescript
 * const form = createForm({
 *   initialData: { name: "" },
 *   onSubmit: async ({ payload }) => ({ ok: true, submitId: String(payload) }),
 * });
 * ```
 */
export function createForm<TData, TUi>(
	options: CreateFormOptions<TData, TUi> = {} as CreateFormOptions<TData, TUi>,
): FormApi<TData, TUi> {
	return new FormRuntime(options).build();
}

/** Opt-in commit-scoped lifecycle for React integrations. Never activate during render or SSR. */
export function createDeferredForm<TData, TUi>(
	options: CreateFormOptions<TData, TUi> = {} as CreateFormOptions<TData, TUi>,
): {
	readonly form: FormApi<TData, TUi>;
	activate(): void;
	deactivate(): void;
} {
	const runtime = new FormRuntime(options, true);
	return {
		form: runtime.build(),
		activate: () => runtime.activate(),
		deactivate: () => runtime.deactivate(),
	};
}
