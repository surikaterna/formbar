import type {
	BindingResolution,
	DefaultBindingContribution,
	InteractionCleanup,
	InteractionTarget,
	LocalInteraction,
	NamedActionRegistration,
	ScopedInteractionCapability,
	TargetRegistration,
	TextInputSource,
} from "./interaction.js";

interface ResolverState {
	readonly defaults: Map<number, readonly DefaultBindingContribution[]>;
	readonly targets: Map<number, readonly TargetRegistration[]>;
	readonly actions: Map<number, readonly NamedActionRegistration[]>;
	readonly listeners: Set<() => void>;
	readonly textListeners: Set<(text: string) => void>;
	revision: number;
	nextId: number;
	disposed: boolean;
}

export interface StandaloneInteraction {
	readonly capability: ScopedInteractionCapability;
	readonly textInput: TextInputSource;
	dispatch(input: string): boolean;
	emitText(text: string): void;
	dispose(): void;
}

export function createStandaloneInteraction(): StandaloneInteraction {
	const state: ResolverState = {
		defaults: new Map(),
		targets: new Map(),
		actions: new Map(),
		listeners: new Set(),
		textListeners: new Set(),
		revision: 0,
		nextId: 0,
		disposed: false,
	};
	return {
		capability: capability(state),
		textInput: { subscribe: (listener) => subscribe(state.textListeners, listener, state) },
		dispatch: (input) => dispatch(state, input),
		emitText: (text) => {
			if (!state.disposed) for (const listener of state.textListeners) listener(text);
		},
		dispose: () => dispose(state),
	};
}

function capability(state: ResolverState): ScopedInteractionCapability {
	return {
		registerTargets: (items) => register(state, state.targets, items, (item) => targetKey(item.target)),
		registerActions: (items) => register(state, state.actions, items, (item) => item.id),
		contributeDefaultBindings: (items) => register(state, state.defaults, items, (item) => item.input),
		getEffectiveBinding: (input) => resolve(state, input),
		getRevision: () => state.revision,
		subscribe: (listener) => subscribe(state.listeners, listener, state),
	};
}

function register<T>(
	state: ResolverState,
	map: Map<number, readonly T[]>,
	items: readonly T[],
	key: (item: T) => string,
): InteractionCleanup {
	assertUnique(items, key);
	if (state.disposed) return () => undefined;
	const id = state.nextId++;
	map.set(id, [...items]);
	notify(state);
	return once(() => {
		if (state.disposed || !map.delete(id)) return;
		notify(state);
	});
}

function resolve(state: ResolverState, input: string): BindingResolution {
	if (state.disposed) return { input, status: "unbound" };
	const matches = [...state.defaults.values()].flat().filter((item) => item.input === input);
	if (matches.length === 0) return { input, status: "unbound" };
	if (matches.length !== 1) return { input, status: "conflicted" };
	const match = matches[0];
	return match ? { ...match, status: "bound" } : { input, status: "unbound" };
}

function dispatch(state: ResolverState, input: string): boolean {
	const binding = resolve(state, input);
	if (binding.status !== "bound") return false;
	for (const handler of [...state.actions.values()].flat().reverse()) {
		if (handler.id === binding.interaction.action && handler.invoke(binding.interaction)) return true;
	}
	const targets = [...state.targets.values()]
		.flat()
		.filter((item) => sameTarget(item.target, binding.interaction.target));
	return targets.length === 1 ? (targets[0]?.invoke(binding.interaction.action) ?? false) : false;
}

function notify(state: ResolverState): void {
	state.revision += 1;
	for (const listener of state.listeners) {
		try {
			listener();
		} catch {
			// Observer failures cannot roll back an already committed resolver revision.
		}
	}
}

function subscribe<T>(listeners: Set<T>, listener: T, state: ResolverState): InteractionCleanup {
	if (state.disposed) return () => undefined;
	listeners.add(listener);
	return once(() => {
		listeners.delete(listener);
	});
}

function dispose(state: ResolverState): void {
	if (state.disposed) return;
	state.disposed = true;
	state.defaults.clear();
	state.targets.clear();
	state.actions.clear();
	state.listeners.clear();
	state.textListeners.clear();
}

function assertUnique<T>(items: readonly T[], key: (item: T) => string): void {
	const seen = new Set<string>();
	for (const item of items) {
		const value = key(item);
		if (seen.has(value)) throw new Error(`Duplicate registration: ${value}`);
		seen.add(value);
	}
}

function sameTarget(left: InteractionTarget, right: InteractionTarget): boolean {
	return (
		left.kind === right.kind &&
		(left.kind === "group" ? left.id === (right as typeof left).id : left.path === (right as typeof left).path)
	);
}

function targetKey(target: InteractionTarget): string {
	return target.kind === "group" ? `group:${target.id}` : `field:${target.path}`;
}
function once(cleanup: () => void): InteractionCleanup {
	let done = false;
	return () => {
		if (!done) {
			done = true;
			cleanup();
		}
	};
}
