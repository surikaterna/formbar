import type { AsyncValidatorConfig } from "./contracts.js";
import { type AbsoluteDataPath, normalizeDataPath } from "./field-policy.js";

export interface NormalizedValidator<TData, TUi> {
	readonly config: AsyncValidatorConfig<TData, TUi>;
	readonly fields: readonly AbsoluteDataPath[];
}

export function normalizeAsyncValidators<TData, TUi>(configs: readonly AsyncValidatorConfig<TData, TUi>[]) {
	const ids = new Set<string>();
	return configs.map((config) => {
		if (!config.id || ids.has(config.id)) throw new Error(`Async validator id must be unique: "${config.id}"`);
		ids.add(config.id);
		return { config, fields: Object.freeze((config.fields ?? []).map(normalizeDataPath)) };
	});
}
