import type { CreateFormOptions, FormApi, SubmitResult } from "@formbar/core";
import { createForm } from "@formbar/core";
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
 * The form is created once on mount and disposed on unmount (StrictMode-safe).
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
export function useForm<TData, TUi>(options?: UseFormOptions<TData, TUi>): FormApi<TData, TUi> {
	const autoFocus = options?.autoFocusOnError ?? true;
	const formRef = useRef<FormApi<TData, TUi> | null>(null);
	const disposeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	if (formRef.current === null) {
		formRef.current = createForm<TData, TUi>(getCoreFormOptions(options));
	}

	const form = formRef.current;

	// Adapt form.subscribe (which passes state) to useSyncExternalStore's expected signature
	const subscribe = useRef((onStoreChange: () => void) => {
		return form.subscribe(onStoreChange);
	}).current;
	const getSnapshot = useRef(() => form.getState()).current;

	useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

	// Deferred disposal: schedule dispose in a macrotask so StrictMode remount can cancel it
	useEffect(() => {
		if (disposeTimerRef.current !== null) {
			clearTimeout(disposeTimerRef.current);
			disposeTimerRef.current = null;
		}
		return () => {
			disposeTimerRef.current = setTimeout(() => {
				formRef.current?.dispose();
			}, 0);
		};
	}, []);

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
