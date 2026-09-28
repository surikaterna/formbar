import { cyclicVertices } from "./computation-cycles.js";
import type { AdmittedSlot } from "./kalada-definition.js";
import { ProgramAdmissionError } from "./kalada-program.js";
import { type StaticReference, staticDependencyKey } from "./static-references.js";

export interface AdmittedComputation {
	readonly id: string;
	readonly path: string;
	readonly target: StaticReference;
	readonly expression: AdmittedSlot;
}

/** Check every declared computation, regardless of whether another slot reads its target. */
export function checkKaladaComputationGraph(entries: readonly AdmittedComputation[]): void {
	const ids = new Set<string>();
	const owners = new Map<string, number>();
	for (const [index, entry] of entries.entries()) {
		if (ids.has(entry.id)) throw new ProgramAdmissionError(`${entry.path}.id`, "DUPLICATE_COMPUTATION_ID");
		ids.add(entry.id);
		const target = staticDependencyKey(entry.target);
		if (owners.has(target)) throw new ProgramAdmissionError(`${entry.path}.target`, "DUPLICATE_COMPUTATION_TARGET");
		owners.set(target, index);
	}
	const edges = new Map<number, readonly number[]>();
	for (const [index, entry] of entries.entries()) {
		const target = staticDependencyKey(entry.target);
		const dependencies = entry.expression.dependencies.map(staticDependencyKey);
		if (dependencies.includes(target)) throw new ProgramAdmissionError(`${entry.path}.expression`, "SELF_DEPENDENCY");
		const linked = dependencies
			.map((key) => owners.get(key))
			.filter((owner): owner is number => owner !== undefined && owner !== index);
		edges.set(index, Object.freeze([...new Set(linked)].sort((left, right) => left - right)));
	}
	const cyclic = cyclicVertices(
		entries.map((_, index) => index),
		edges,
	);
	if (cyclic.size) {
		const index = Math.min(...cyclic);
		throw new ProgramAdmissionError(`${entries[index]?.path}.expression`, "COMPUTATION_CYCLE");
	}
}
