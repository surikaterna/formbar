type Listener = (...args: unknown[]) => void;

export class EventEmitter {
	readonly #listeners = new Map<string | symbol, Set<Listener>>();

	on(event: string | symbol, listener: Listener): this {
		const listeners = this.#listeners.get(event) ?? new Set<Listener>();
		listeners.add(listener);
		this.#listeners.set(event, listeners);
		return this;
	}

	addListener(event: string | symbol, listener: Listener): this {
		return this.on(event, listener);
	}

	removeListener(event: string | symbol, listener: Listener): this {
		this.#listeners.get(event)?.delete(listener);
		return this;
	}

	off(event: string | symbol, listener: Listener): this {
		return this.removeListener(event, listener);
	}

	emit(event: string | symbol, ...args: unknown[]): boolean {
		const listeners = [...(this.#listeners.get(event) ?? [])];
		for (const listener of listeners) listener(...args);
		return listeners.length > 0;
	}

	listenerCount(event: string | symbol): number {
		return this.#listeners.get(event)?.size ?? 0;
	}
}
