import type {
	BindingResolution,
	DefaultBindingContribution,
	InteractionCleanup,
	InteractionTarget,
	NamedActionRegistration,
	ScopedInteractionCapability,
	TargetRegistration,
	TextInputSource,
} from "../index.js";

type Listener = () => void;

export class FakeInteractionHost implements ScopedInteractionCapability {
	readonly #targets = new Map<symbol, readonly TargetRegistration[]>();
	readonly #actions = new Map<symbol, readonly NamedActionRegistration[]>();
	readonly #defaults = new Map<symbol, readonly DefaultBindingContribution[]>();
	readonly #listeners = new Set<Listener>();
	#revision = 0;

	registerTargets(targets: readonly TargetRegistration[]): InteractionCleanup {
		assertUnique(targets, ({ target }) => targetKey(target));
		return this.#register(this.#targets, targets);
	}

	registerActions(actions: readonly NamedActionRegistration[]): InteractionCleanup {
		assertUnique(actions, ({ id }) => id);
		return this.#register(this.#actions, actions);
	}

	contributeDefaultBindings(bindings: readonly DefaultBindingContribution[]): InteractionCleanup {
		return this.#register(this.#defaults, bindings);
	}

	getEffectiveBinding(input: string): BindingResolution {
		const matches = [...this.#defaults.values()].flat().filter((binding) => binding.input === input);
		if (matches.length === 0) return { input, status: "unbound" };
		if (matches.length > 1) return { input, status: "conflicted" };
		const match = matches[0];
		return match === undefined ? { input, status: "unbound" } : { ...match, status: "bound" };
	}

	getRevision(): number {
		return this.#revision;
	}

	subscribe(listener: Listener): InteractionCleanup {
		this.#listeners.add(listener);
		return noThrowOnce(() => this.#listeners.delete(listener));
	}

	dispatch(input: string): boolean {
		const resolution = this.getEffectiveBinding(input);
		if (resolution.status !== "bound") return false;
		for (const action of [...this.#actions.values()].flat().reverse()) {
			if (action.id === resolution.interaction.action && action.invoke(resolution.interaction)) return true;
		}
		const targets = [...this.#targets.values()]
			.flat()
			.filter(({ target }) => targetKey(target) === targetKey(resolution.interaction.target));
		return targets.length === 1 ? (targets[0]?.invoke(resolution.interaction.action) ?? false) : false;
	}

	#register<T>(store: Map<symbol, readonly T[]>, batch: readonly T[]): InteractionCleanup {
		const token = Symbol("registration");
		store.set(token, [...batch]);
		this.#changed();
		return noThrowOnce(() => {
			if (!store.delete(token)) return;
			this.#changed();
		});
	}

	#changed(): void {
		this.#revision += 1;
		for (const listener of this.#listeners) {
			try {
				listener();
			} catch {}
		}
	}
}

export class FakeTextInputSource implements TextInputSource {
	readonly #listeners = new Set<(text: string) => void>();

	subscribe(listener: (text: string) => void): InteractionCleanup {
		this.#listeners.add(listener);
		return noThrowOnce(() => this.#listeners.delete(listener));
	}

	emit(text: string): void {
		for (const listener of this.#listeners) listener(text);
	}
}

function assertUnique<T>(items: readonly T[], key: (item: T) => string): void {
	const keys = new Set<string>();
	for (const item of items) {
		const value = key(item);
		if (keys.has(value)) throw new Error(`Duplicate registration: ${value}`);
		keys.add(value);
	}
}

function targetKey(target: InteractionTarget): string {
	return target.kind === "field" ? `field:${target.path}` : `group:${target.id}`;
}

function noThrowOnce(cleanup: () => unknown): InteractionCleanup {
	let cleaned = false;
	return () => {
		if (cleaned) return;
		cleaned = true;
		try {
			cleanup();
		} catch {}
	};
}
