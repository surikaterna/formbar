import { CallbackBoundary } from "@formbar/expressions";

export function createResetSignal() {
	const listeners = new Set<() => void>();
	const lifecycle = new CallbackBoundary();
	let notifying = false;
	return {
		onReset(listener: () => void): () => void {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		notify(): void {
			if (notifying) return;
			notifying = true;
			try {
				lifecycle.runAll([...listeners]);
			} finally {
				notifying = false;
			}
		},
		clear(): void {
			listeners.clear();
		},
	};
}
