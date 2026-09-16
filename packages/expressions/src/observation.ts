import { synchronousValue } from "./async.js";
import { CallbackBoundary } from "./callback-boundary.js";
import type { Observation } from "./contracts.js";

type Reader<T> = (active: () => boolean, disposed: boolean) => T;
type Connect = (listener: () => void) => () => void;

class LazyObservation<T> implements Observation<T> {
	private snapshot!: T;
	private initialized = false;
	private disposed = false;
	private generation = 0;
	private cleanup: (() => void) | undefined;
	private readonly listeners = new Set<() => void>();

	constructor(
		private read: Reader<T>,
		private connect: Connect,
		private equal: (a: T, b: T) => boolean,
		private lifecycle: CallbackBoundary,
	) {}

	getLifecycleDiagnostics = () => this.lifecycle.getDiagnostics();

	getSnapshot = (): T => {
		const token = this.generation;
		const active = () => !this.disposed && this.listeners.size > 0 && token === this.generation;
		const next = this.read(active, this.disposed);
		if (!this.initialized || !this.equal(this.snapshot, next)) this.snapshot = next;
		this.initialized = true;
		return this.snapshot;
	};

	private notify = (): void => {
		const previous = this.snapshot;
		if (this.getSnapshot() !== previous) this.lifecycle.runAll([...this.listeners]);
	};

	subscribe = (listener: () => void): (() => void) => {
		if (this.disposed) return () => {};
		const callback = () => listener();
		this.listeners.add(callback);
		try {
			if (!this.cleanup) this.attach();
		} catch (error) {
			this.listeners.delete(callback);
			if (!this.listeners.size) this.disconnect();
			throw error;
		}
		return () => {
			if (!this.listeners.delete(callback)) return;
			if (!this.listeners.size) this.disconnect();
		};
	};

	private attach(): void {
		const cleanup = synchronousValue(this.connect(this.notify));
		if (this.disposed || !this.listeners.size) this.lifecycle.run(cleanup);
		else this.cleanup = cleanup;
	}

	private disconnect(): void {
		const cleanup = this.cleanup;
		this.cleanup = undefined;
		this.generation++;
		this.initialized = false;
		if (cleanup) this.lifecycle.run(cleanup);
	}

	dispose = (): void => {
		if (this.disposed) return;
		this.disposed = true;
		const listeners = [...this.listeners];
		this.listeners.clear();
		this.disconnect();
		this.getSnapshot();
		this.lifecycle.runAll(listeners);
	};
}

/** Construction/getSnapshot never acquire resources, including during abandoned React renders. */
export function createObservation<T>(
	read: Reader<T>,
	connect: Connect,
	equal: (a: T, b: T) => boolean = (a, b) => JSON.stringify(a) === JSON.stringify(b),
	lifecycle = new CallbackBoundary(),
): Observation<T> {
	return new LazyObservation(read, connect, equal, lifecycle);
}
