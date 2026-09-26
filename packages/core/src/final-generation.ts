/** Private per-attempt transition witness; never certifies an issue or an omission. */
export interface FinalGeneration {
	readonly sync: {
		begin(generation: number): boolean;
		settle(generation: number): void;
	};
	readonly async: {
		begin(generation: number): boolean;
		settle(generation: number): void;
	};
	readonly syncCurrent: () => boolean;
	readonly current: () => boolean;
}

export function beginFinalGeneration(
	syncGeneration: () => number,
	asyncGeneration: () => number,
	guard: () => boolean,
): FinalGeneration {
	const beforeSync = syncGeneration();
	const beforeAsync = asyncGeneration();
	let ownSync: number | undefined;
	let ownAsync: number | undefined;
	let settledSync = false;
	let settledAsync = false;
	return {
		sync: {
			begin: (generation) => {
				if (ownSync !== undefined || generation !== beforeSync + 1 || !guard()) return false;
				ownSync = generation;
				return true;
			},
			settle: (generation) => {
				settledSync = generation === ownSync && syncGeneration() === generation && guard();
			},
		},
		async: {
			begin: (generation) => {
				if (ownAsync !== undefined || generation !== beforeAsync + 1 || !guard() || !settledSync) return false;
				ownAsync = generation;
				return true;
			},
			settle: (generation) => {
				settledAsync = generation === ownAsync && asyncGeneration() === generation && guard();
			},
		},
		syncCurrent: () => settledSync && guard() && syncGeneration() === ownSync && asyncGeneration() === beforeAsync,
		current: () =>
			settledSync && settledAsync && guard() && syncGeneration() === ownSync && asyncGeneration() === ownAsync,
	};
}
