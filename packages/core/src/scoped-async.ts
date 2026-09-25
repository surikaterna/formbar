import type { FormApi } from "./contracts.js";
import type { CanonicalSegment } from "./path.js";
import type { ScopedFieldIssueInput, ScopedValidationInput } from "./scoped-sync.js";
import type { FormStateCapture } from "./state.js";

export interface ScopedAsyncField {
	readonly id: string;
	readonly fieldId: string;
	readonly instanceKey: string;
	readonly binding: { readonly namespace: "data"; readonly segments: readonly CanonicalSegment[] };
	readonly trigger: "onChange" | "onBlur";
	readonly debounceMs: number;
	readonly validate: (input: ScopedValidationInput<unknown, unknown>) => Promise<readonly ScopedFieldIssueInput[]>;
}

export interface ScopedAsyncHost<TData, TUi> {
	readonly ids: ReadonlySet<string>;
	instances(
		form: FormApi<TData, TUi>,
		capture: FormStateCapture<TData, TUi>,
	): {
		readonly current: () => boolean;
		readonly fields: readonly ScopedAsyncField[];
	};
}

const hosts = new WeakMap<object, ScopedAsyncHost<never, never>>();

export function registerScopedAsync<TData, TUi>(
	form: FormApi<TData, TUi>,
	host: ScopedAsyncHost<TData, TUi>,
	legacyIds: readonly string[],
): void {
	if (form.isDisposed() || hosts.has(form))
		throw new TypeError("Scoped async host already registered or form disposed");
	assertScopedAsyncIds(host, legacyIds);
	hosts.set(form, host as unknown as ScopedAsyncHost<never, never>);
}

export function assertScopedAsyncIds<TData, TUi>(
	host: ScopedAsyncHost<TData, TUi>,
	legacyIds: readonly string[],
): void {
	for (const id of legacyIds) if (host.ids.has(id)) throw new TypeError(`Duplicate async validator id: ${id}`);
}

export function scopedAsyncHost<TData, TUi>(form: FormApi<TData, TUi>): ScopedAsyncHost<TData, TUi> | undefined {
	return hosts.get(form) as unknown as ScopedAsyncHost<TData, TUi> | undefined;
}
