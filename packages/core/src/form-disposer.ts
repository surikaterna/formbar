import type { createDisposalSignal } from "./disposal-signal.js";

interface DisposalHook {
	onDispose?(): void;
}
interface Resources {
	abort(): void;
	cancel(): void;
	readonly plugins: readonly DisposalHook[];
	readonly pluginDisposers: (() => void)[];
	readonly middlewares: readonly DisposalHook[];
	clearFields(): void;
	disposeStore(): void;
}

/** Detach owned handles before callbacks; reentrant disposal cannot repeat or interrupt teardown. */
export function createFormDisposer(signal: ReturnType<typeof createDisposalSignal>, resources: Resources): () => void {
	return () => {
		if (signal.isDisposed()) return;
		signal.dispose([
			resources.abort,
			resources.cancel,
			...resources.plugins.map((plugin) => () => plugin.onDispose?.()),
			...resources.pluginDisposers.splice(0),
			...resources.middlewares.map((middleware) => () => middleware.onDispose?.()),
			resources.clearFields,
			resources.disposeStore,
		]);
	};
}
