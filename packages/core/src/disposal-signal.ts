import { CallbackBoundary } from "@formbar/expressions";

export function createDisposalSignal() {
	let disposed = false;
	const listeners = new Set<() => void>();
	const lifecycle = new CallbackBoundary();
	return {
		isDisposed: () => disposed,
		getDiagnostics: lifecycle.getDiagnostics,
		onDispose(listener: () => void): () => void {
			if (disposed) {
				lifecycle.run(listener);
				return () => {};
			}
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		dispose(teardown: readonly (() => unknown)[] = []): void {
			if (disposed) return;
			disposed = true;
			const observers = [...listeners];
			listeners.clear();
			lifecycle.runAll(observers);
			lifecycle.runAll(teardown);
		},
	};
}
