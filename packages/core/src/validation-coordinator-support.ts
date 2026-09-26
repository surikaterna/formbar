import type { NormalizedValidator } from "./async-validator-normalization.js";
import type { AbsoluteDataPath } from "./field-policy.js";

export type Cancellation = "superseded" | "aborted";

export interface RunToken {
	readonly kind: "automatic" | "foreground";
	readonly revision: number;
	readonly lifecycle: number;
	readonly validatorGenerations: ReadonlyMap<string, number>;
	readonly validatorIds: ReadonlySet<string>;
	readonly paths: AbsoluteDataPath[];
	readonly controller: AbortController;
	readonly cancelled: Promise<Cancellation>;
	semanticCurrent?: () => boolean;
	resolveCancellation(reason: Cancellation): void;
	cancellation?: Cancellation;
	timer?: ReturnType<typeof setTimeout> | undefined;
}

export function overlaps(a: AbsoluteDataPath, b: AbsoluteDataPath): boolean {
	const length = Math.min(a.segments.length, b.segments.length);
	for (let index = 0; index < length; index++) if (a.segments[index] !== b.segments[index]) return false;
	return true;
}

export function selectValidators<TData, TUi>(
	validators: readonly NormalizedValidator<TData, TUi>[],
	scope?: AbsoluteDataPath,
	trigger?: "onChange" | "onBlur",
): readonly NormalizedValidator<TData, TUi>[] {
	if (!scope) return validators;
	return validators.filter((validator) => {
		if (trigger && (validator.config.trigger ?? "onChange") !== trigger) return false;
		return validator.fields.length === 0
			? trigger !== undefined
			: validator.fields.some((field) => overlaps(field, scope));
	});
}

/** #310 post-notification generation check: never report a superseded foreground as completed. */
export function isSettledCurrent(
	token: RunToken,
	generation: number,
	foregroundGeneration: number,
	lifecycle: number,
	revision: number,
	versions: ReadonlyMap<string, number>,
): boolean {
	if (foregroundGeneration !== generation || token.cancellation) return false;
	if (token.lifecycle !== lifecycle || token.revision !== revision) return false;
	for (const [id, version] of token.validatorGenerations) {
		if (versions.get(id) !== version) return false;
	}
	return true;
}

export function nextValidatorGeneration(versions: Map<string, number>, id: string): number {
	const generation = (versions.get(id) ?? 0) + 1;
	versions.set(id, generation);
	return generation;
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
		paths: [...paths],
		controller: new AbortController(),
		cancelled,
		resolveCancellation,
	};
}
