import type { FieldMetaEntry, FormState } from "./state.js";

export interface ValidationStatusDeps<TData, TUi> {
	readonly getState: () => FormState<TData, TUi>;
	readonly updateState: (updater: (state: FormState<TData, TUi>) => FormState<TData, TUi>) => void;
	readonly publishValidationStatus?: (paths: ReadonlySet<string>, validating: boolean) => void;
}

export function projectValidationStatus<TData, TUi>(
	deps: ValidationStatusDeps<TData, TUi>,
	paths: ReadonlySet<string>,
	validating: boolean,
): void {
	const current = deps.getState();
	if (
		current.meta.validation.validating === validating &&
		![...paths].some((key) => !(key in current.fieldMeta)) &&
		!Object.entries(current.fieldMeta).some(([key, meta]) => meta.isValidating !== paths.has(key))
	)
		return;
	if (deps.publishValidationStatus) {
		deps.publishValidationStatus(paths, validating);
		return;
	}
	deps.updateState((state) => {
		const fieldMeta = { ...state.fieldMeta } as Record<string, FieldMetaEntry>;
		const remaining = new Set(paths);
		for (const [key, meta] of Object.entries(fieldMeta)) {
			const active = remaining.delete(key);
			if (meta.isValidating !== active) fieldMeta[key] = { ...meta, isValidating: active };
		}
		for (const key of remaining) {
			fieldMeta[key] = { touched: false, dirty: false, listenerTriggered: false, isValidating: true };
		}
		return {
			...state,
			fieldMeta,
			meta: { ...state.meta, validation: { ...state.meta.validation, validating } },
		};
	});
}
