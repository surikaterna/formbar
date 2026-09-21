import { createArrayHelpers } from "./array-helpers.js";
import type { FieldApi, FieldConfig, FormDispatchResult } from "./contracts.js";
import { structuredEqual } from "./equality.js";
import { fieldMetaKey, normalizeDataPath } from "./field-policy.js";
import type { CanonicalPath } from "./path.js";
import type { FieldMetaEntry, FormState, ValidationIssue } from "./state.js";
import { shouldShowIssues } from "./trigger-filter.js";
import type { DeepValue } from "./type-utils.js";

/** Resolve a value from a nested object by walking canonical path segments */
function resolveValue(root: unknown, segments: readonly (string | number)[]): unknown {
	let current: unknown = root;
	for (const seg of segments) {
		if (current === null || current === undefined) return undefined;
		current = (current as Record<string | number, unknown>)[seg];
	}
	return current;
}

export interface CreateFieldApiParams<TData, TUi> {
	readonly path: CanonicalPath;
	readonly rawPath: string;
	readonly getState: () => FormState<TData, TUi>;
	readonly setValue: (path: string, value: unknown) => FormDispatchResult;
	readonly getIssues: (path: CanonicalPath) => readonly ValidationIssue[];
	readonly getInitialValue: () => unknown;
	readonly getFieldMeta: (pathKey: string) => FieldMetaEntry | undefined;
	readonly markTouched: (pathKey: string, path: CanonicalPath) => void;
	readonly getFormSubmitted: () => boolean;
	readonly updateFieldMeta: (updater: (meta: Record<string, FieldMetaEntry>) => Record<string, FieldMetaEntry>) => void;
	/** Form-level field defaults (tier 2) */
	readonly formDefaults?: FieldConfig | undefined;
	/** Field-level overrides (tier 3, highest priority) */
	readonly config?: FieldConfig | undefined;
}

/**
 * 3-tier merge: schema defaults (tier 1, future) < form-level defaults (tier 2) < field-level overrides (tier 3).
 * Later tiers override earlier ones for defined (non-undefined) properties.
 */
export function mergeFieldConfig(formDefaults?: FieldConfig, fieldOverrides?: FieldConfig): FieldConfig | undefined {
	if (!formDefaults && !fieldOverrides) return undefined;
	if (!formDefaults) return fieldOverrides;
	if (!fieldOverrides) return formDefaults;
	return { ...formDefaults, ...stripUndefined(fieldOverrides) };
}

function stripUndefined(obj: FieldConfig): Partial<FieldConfig> {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(obj)) {
		if (value !== undefined) result[key] = value;
	}
	return result as Partial<FieldConfig>;
}

class FieldApiImplementation<TData, TUi> implements FieldApi<TData, TUi, string> {
	readonly path: CanonicalPath;
	readonly pathKey: string;

	constructor(private readonly params: CreateFieldApiParams<TData, TUi>) {
		this.path = params.path;
		this.pathKey =
			params.path.namespace === "data"
				? fieldMetaKey(normalizeDataPath({ namespace: "data", segments: params.path.segments }))
				: params.rawPath;
	}

	get(): DeepValue<TData, string> {
		const state = this.params.getState();
		const root = this.path.namespace === "ui" ? state.uiState : state.data;
		return resolveValue(root, this.path.segments) as DeepValue<TData, string>;
	}

	set(value: DeepValue<TData, string>): FormDispatchResult {
		return this.params.setValue(this.params.rawPath, value);
	}

	validate(): readonly ValidationIssue[] {
		const config = mergeFieldConfig(this.params.formDefaults, this.params.config);
		if (!config?.validators?.length) return [];
		const state = this.params.getState();
		const issues: ValidationIssue[] = [];
		for (const validator of config.validators) {
			const input = {
				data: state.data,
				uiState: state.uiState,
				...(state.meta.stage !== undefined ? { stage: state.meta.stage } : {}),
			};
			const result = validator(input);
			if (Array.isArray(result)) issues.push(...result);
		}
		return issues;
	}

	issues(): readonly ValidationIssue[] {
		const context = {
			fieldMeta: this.params.getFieldMeta(this.pathKey),
			formSubmitted: this.params.getFormSubmitted(),
		};
		return shouldShowIssues(this.params.config?.validationTriggers, context) ? this.params.getIssues(this.path) : [];
	}

	ui<T = unknown>(selector: (uiState: TUi) => T): T {
		return selector(this.params.getState().uiState);
	}

	isTouched(): boolean {
		return this.params.getFieldMeta(this.pathKey)?.touched ?? false;
	}

	isDirty(): boolean {
		return !structuredEqual(this.get(), this.params.getInitialValue());
	}

	isValidating(): boolean {
		return this.params.getFieldMeta(this.pathKey)?.isValidating ?? false;
	}

	markTouched(): void {
		this.params.markTouched(this.pathKey, this.path);
	}

	handleChange(value: DeepValue<TData, string>): FormDispatchResult {
		return this.set(value);
	}

	handleBlur(): void {
		this.markTouched();
	}
}

export function createFieldApi<TData, TUi>(params: CreateFieldApiParams<TData, TUi>): FieldApi<TData, TUi, string> {
	const fieldApi = new FieldApiImplementation(params);
	const arrayHelpers = createArrayHelpers({
		get: () => fieldApi.get(),
		set: (value: unknown) => fieldApi.set(value as DeepValue<TData, string>),
		pathKey: fieldApi.pathKey,
		updateFieldMeta: params.updateFieldMeta,
	});
	return Object.assign(fieldApi, arrayHelpers);
}
