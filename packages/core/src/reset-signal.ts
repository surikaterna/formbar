import { CallbackBoundary } from "@formbar/expressions";

export function createResetSignal() {
	const listeners = new Set<() => void>();
	const lifecycle = new CallbackBoundary();
	return {
		onReset(listener: () => void): () => void {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		notify(): void {
			lifecycle.runAll([...listeners]);
		},
		clear(): void {
			listeners.clear();
		},
	};
}
