import { structuredEqual } from "@formbar/core";
import { CallbackBoundary } from "@formbar/expressions";
import type { Observation } from "@formbar/expressions";

export class RuntimeObservation<T> implements Observation<T> {
	private readonly lifecycle = new CallbackBoundary();
	private readonly listeners = new Set<() => void>();
	private cleanup: (() => void) | undefined;
	private snapshot: T | undefined;
	private initialized = false;
	private disposed = false;

	constructor(
		private read: (() => T) | undefined,
		private connect: ((listener: () => void) => () => void) | undefined,
		private release?: (observation: RuntimeObservation<T>) => void,
	) {}

	getSnapshot = (): T => {
		if (!this.read) return this.snapshot as T;
		const next = this.read();
		if (!this.initialized || !structuredEqual(this.snapshot, next)) this.snapshot = next;
		this.initialized = true;
		return this.snapshot as T;
	};

	getLifecycleDiagnostics = () => this.lifecycle.getDiagnostics();

	subscribe = (listener: () => void): (() => void) => {
		if (this.disposed) return () => {};
		const callback = () => listener();
		this.listeners.add(callback);
		if (!this.cleanup && this.connect) this.connectOnce();
		return () => {
			if (!this.listeners.delete(callback) || this.listeners.size) return;
			this.disconnect();
		};
	};

	private connectOnce(): void {
		const connect = this.connect;
		if (!connect) return;
		const cleanup = connect(this.notify);
		if (this.disposed || !this.listeners.size) this.lifecycle.run(cleanup);
		else this.cleanup = cleanup;
	}

	private notify = (): void => {
		const previous = this.snapshot;
		if (this.getSnapshot() !== previous) this.lifecycle.runAll([...this.listeners]);
	};

	private disconnect(): void {
		const cleanup = this.cleanup;
		this.cleanup = undefined;
		this.initialized = false;
		this.snapshot = undefined;
		if (cleanup) this.lifecycle.run(cleanup);
	}

	dispose = (): void => {
		if (this.disposed) return;
		this.disposed = true;
		this.listeners.clear();
		this.disconnect();
		this.read = undefined;
		this.connect = undefined;
		const release = this.release;
		this.release = undefined;
		release?.(this);
	};
}
