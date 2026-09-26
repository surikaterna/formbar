import type { AsyncValidationResult } from "./contracts.js";
import type { ScopedForeground } from "./scoped-async-scheduler.js";
import type { ValidationIssue } from "./state.js";
import type { RunToken } from "./validation-coordinator-support.js";
import { normalizeIssues } from "./validation.js";

interface Settlement {
	readonly token: RunToken;
	readonly outcome: (readonly ValidationIssue[])[];
	readonly scoped: ScopedForeground | undefined;
	readonly candidate: boolean;
	readonly signal: AbortSignal | undefined;
	readonly semanticCurrent: () => boolean;
	readonly isCurrent: () => boolean;
	readonly stale: () => AsyncValidationResult;
	readonly publish: (
		legacy: readonly ValidationIssue[],
		scoped: readonly ValidationIssue[],
	) => readonly ValidationIssue[];
	readonly fail: () => void;
	readonly generation: () => number;
	readonly detach: () => void;
	readonly project: () => void;
	readonly isSettledCurrent: (generation: number) => boolean;
}

/** Complete only after both synchronous issue and validating:false subscriber deliveries. */
export function settleForeground(options: Settlement): AsyncValidationResult {
	const { token, outcome, scoped, candidate, signal, semanticCurrent } = options;
	if (!options.isCurrent() || !semanticCurrent()) return options.stale();
	const scopedIssues = scoped ? (outcome.pop() ?? []) : [];
	let issues: readonly ValidationIssue[];
	try {
		issues = candidate
			? normalizeIssues([...outcome.flat(), ...scopedIssues])
			: options.publish(outcome.flat(), scopedIssues);
	} catch (error) {
		options.fail();
		throw error;
	}
	const valid = !signal?.aborted && semanticCurrent() && options.isCurrent();
	const generation = options.generation();
	options.detach();
	options.project();
	if (signal?.aborted) return { status: "aborted", issues: [] };
	return valid && options.isSettledCurrent(generation) && semanticCurrent()
		? { status: "completed", issues }
		: { status: token.cancellation ?? "superseded", issues: [] };
}
