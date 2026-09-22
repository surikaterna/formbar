import { CallbackBoundary } from "@formbar/expressions";
import type { Observation } from "@formbar/expressions";

export class RuntimeObservation<T> implements Observation<T> {
	private readonly lifecycle = new CallbackBoundary();
	private readonly listeners = new Set<() => void>();
	private cleanup: (() => void) | undefined;
	private snapshot!: T;
	private initialized = false;
	private disposed = false;

	constructor(
		private readonly read: () => T,
		private readonly connect: (listener: () => void) => () => void,
	) {}

	getSnapshot = (): T => {
		const next = this.read();
		if (!this.initialized || JSON.stringify(this.snapshot) !== JSON.stringify(next)) this.snapshot = next;
		this.initialized = true;
		return this.snapshot;
	};

	getLifecycleDiagnostics = () => this.lifecycle.getDiagnostics();

	subscribe = (listener: () => void): (() => void) => {
		if (this.disposed) return () => {};
		this.listeners.add(listener);
		if (!this.cleanup) this.cleanup = this.connect(this.notify);
		return () => {
			if (!this.listeners.delete(listener) || this.listeners.size) return;
			this.disconnect();
		};
	};

	private notify = (): void => {
		const previous = this.snapshot;
		if (this.getSnapshot() !== previous) this.lifecycle.runAll([...this.listeners]);
	};

	private disconnect(): void {
		const cleanup = this.cleanup;
		this.cleanup = undefined;
		this.initialized = false;
		if (cleanup) this.lifecycle.run(cleanup);
	}

	dispose = (): void => {
		if (this.disposed) return;
		this.disposed = true;
		this.listeners.clear();
		this.disconnect();
	};
}
