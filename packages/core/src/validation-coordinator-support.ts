import type { AsyncValidatorConfig } from "./contracts.js";
import { type AbsoluteDataPath, normalizeDataPath } from "./field-policy.js";
import type { ValidationIssue } from "./state.js";

export const DEFAULT_DEBOUNCE_MS = 300;
export type Cancellation = "superseded" | "aborted";

export interface NormalizedValidator<TData, TUi> {
	readonly config: AsyncValidatorConfig<TData, TUi>;
	readonly fields: readonly AbsoluteDataPath[];
}

export interface RunToken {
	readonly kind: "automatic" | "foreground";
	readonly revision: number;
	readonly lifecycle: number;
	readonly validatorGenerations: ReadonlyMap<string, number>;
	readonly validatorIds: ReadonlySet<string>;
	readonly paths: readonly AbsoluteDataPath[];
	readonly controller: AbortController;
	readonly cancelled: Promise<Cancellation>;
	resolveCancellation(reason: Cancellation): void;
	cancellation?: Cancellation;
	timer?: ReturnType<typeof setTimeout> | undefined;
}

export function overlaps(a: AbsoluteDataPath, b: AbsoluteDataPath): boolean {
	const length = Math.min(a.segments.length, b.segments.length);
	for (let index = 0; index < length; index++) if (a.segments[index] !== b.segments[index]) return false;
	return true;
}

export function normalizeValidators<TData, TUi>(configs: readonly AsyncValidatorConfig<TData, TUi>[]) {
	const ids = new Set<string>();
	return configs.map((config) => {
		if (!config.id || ids.has(config.id)) throw new Error(`Async validator id must be unique: "${config.id}"`);
		ids.add(config.id);
		return { config, fields: Object.freeze((config.fields ?? []).map(normalizeDataPath)) };
	});
}

export function canonicalizeIssue(issue: ValidationIssue, validatorId: string): ValidationIssue {
	const path =
		issue.path.namespace === "data" && issue.path.segments.length > 0
			? normalizeDataPath({ namespace: "data", segments: issue.path.segments })
			: issue.path;
	return { ...issue, path, source: { ...issue.source, origin: "async-validator", validatorId } };
}

export function exceptionIssue(validator: NormalizedValidator<unknown, unknown>, error: unknown): ValidationIssue {
	return {
		code: "ASYNC_VALIDATOR_EXCEPTION",
		message: error instanceof Error ? error.message : String(error),
		severity: "error",
		path: validator.fields[0] ?? { namespace: "data", segments: [] },
		source: { origin: "async-validator", validatorId: validator.config.id },
	};
}

export function createToken(
	kind: RunToken["kind"],
	revision: number,
	lifecycle: number,
	validatorGenerations: ReadonlyMap<string, number>,
	paths: readonly AbsoluteDataPath[],
): RunToken {
	let resolveCancellation!: (reason: Cancellation) => void;
	const cancelled = new Promise<Cancellation>((resolve) => {
		resolveCancellation = resolve;
	});
	return {
		kind,
		revision,
		lifecycle,
		validatorGenerations,
		validatorIds: new Set(validatorGenerations.keys()),
		paths,
		controller: new AbortController(),
		cancelled,
		resolveCancellation,
	};
}
