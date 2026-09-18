import type { InteractionCleanup } from "./interaction.js";

export function runReverse(cleanups: readonly InteractionCleanup[]): void {
	for (let index = cleanups.length - 1; index >= 0; index -= 1) {
		try {
			cleanups[index]?.();
		} catch {
			// Continue releasing earlier resources after a cleanup failure.
		}
	}
}

export function once(cleanup: () => unknown): InteractionCleanup {
	let done = false;
	return () => {
		if (done) return;
		done = true;
		cleanup();
	};
}
