import type { CreateFormOptions, FormApi, SubmitResult } from "@formbar/core";
import { createDeferredForm } from "@formbar/core";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { focusFirstError } from "./a11y.js";
import { getCoreFormOptions } from "./core-form-options.js";

/** Options for useForm, extending core CreateFormOptions with React-specific behavior */
export interface UseFormOptions<TData, TUi> extends CreateFormOptions<TData, TUi> {
	/** Auto-focus the first error field on submit failure (default: true) */
	readonly autoFocusOnError?: boolean;
}

/**
 * React hook that creates and manages a form instance with automatic cleanup.
 * The store is retained across StrictMode replay; plugin init resources are commit-scoped.
 * Unmount releases those resources but does not permanently dispose externally held form APIs.
 *
 * @param options - Form configuration (same as {@link createForm} options).
 * @returns A stable {@link FormApi} reference that persists across re-renders.
 *
 * @example
 * ```typescript
 * function ContactForm() {
 *   const form = useForm({
 *     initialData: { name: "", email: "" },
 *     onSubmit: async ({ payload }) => {
 *       await saveContact(payload);
 *       return { ok: true, submitId: "1" };
 *     },
 *   });
 *
 *   return <input value={form.field("name").get()} onChange={e => form.field("name").set(e.target.value)} />;
 * }
 * ```
 */
export function useForm<TData, TUi>(
	options?: UseFormOptions<TData, TUi>,
	construct: (
		options: CreateFormOptions<TData, TUi>,
	) => ReturnType<typeof createDeferredForm<TData, TUi>> = createDeferredForm,
): FormApi<TData, TUi> {
	const autoFocus = options?.autoFocusOnError ?? true;
	const runtimeRef = useRef<ReturnType<typeof createDeferredForm<TData, TUi>> | null>(null);

	if (runtimeRef.current === null) {
		runtimeRef.current = construct(getCoreFormOptions(options) ?? ({} as CreateFormOptions<TData, TUi>));
	}

	const runtime = runtimeRef.current;
	const form = runtime.form;

	// Adapt form.subscribe (which passes state) to useSyncExternalStore's expected signature
	const subscribe = useRef((onStoreChange: () => void) => {
		return form.subscribe(onStoreChange);
	}).current;
	const getSnapshot = useRef(() => form.getState()).current;

	useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

	useEffect(() => {
		runtime.activate();
		return () => runtime.deactivate();
	}, [runtime]);

	// Wrap the form API to auto-focus on submit errors (ADR §12)
	const wrappedApi = useMemo((): FormApi<TData, TUi> => {
		if (!autoFocus) return form;

		return {
			...form,
			submit: async (...args: Parameters<FormApi<TData, TUi>["submit"]>): Promise<SubmitResult> => {
				const result = await form.submit(...args);
				if (!result.ok && result.fieldIssues?.length) {
					focusFirstError(result.fieldIssues);
				}
				return result;
			},
		};
	}, [form, autoFocus]);

	return wrappedApi;
}
