import type {
	BindingContribution,
	BindingResolution,
	Cleanup,
	NamedActionRegistration,
	ScopedInteractionCapability,
	TargetRegistration,
} from "./contracts.js";

export interface HostScopeMetadata {
	readonly formType: string;
	readonly placement: string;
}

export interface OverrideSelector {
	readonly formType?: string;
	readonly placement?: string;
}

export interface HostScope {
	readonly capability: ScopedInteractionCapability;
	activate(): void;
	dispatch(input: string): boolean;
	dispose(): void;
}

interface ScopeState {
	readonly token: symbol;
	readonly metadata: HostScopeMetadata;
	readonly defaults: Map<number, readonly BindingContribution[]>;
	readonly targets: Map<number, readonly TargetRegistration[]>;
	readonly actions: Map<number, readonly NamedActionRegistration[]>;
	readonly listeners: Set<() => void>;
	revision: number;
	disposed: boolean;
}

interface OverrideEntry {
	readonly selector: OverrideSelector;
	readonly binding: BindingContribution;
}

interface EngineState {
	readonly scopes: Map<symbol, ScopeState>;
	readonly overrides: Map<number, OverrideEntry>;
	active: symbol | undefined;
	nextRegistration: number;
}

export interface MemoryInteractionEngine {
	mount(metadata: HostScopeMetadata): HostScope;
	addOverride(selector: OverrideSelector, binding: BindingContribution): Cleanup;
	dispatchActive(input: string): boolean;
}

export function createMemoryInteractionEngine(): MemoryInteractionEngine {
	const engine: EngineState = {
		scopes: new Map(),
		overrides: new Map(),
		active: undefined,
		nextRegistration: 0,
	};
	return {
		mount: (metadata) => mountScope(engine, metadata),
		addOverride: (selector, binding) => addOverride(engine, selector, binding),
		dispatchActive: (input) => dispatchActive(engine, input),
	};
}

function mountScope(engine: EngineState, metadata: HostScopeMetadata): HostScope {
	const token = Symbol("interaction-scope");
	const state: ScopeState = {
		token,
		metadata,
		defaults: new Map(),
		targets: new Map(),
		actions: new Map(),
		listeners: new Set(),
		revision: 0,
		disposed: false,
	};
	engine.scopes.set(token, state);
	const resolve = (scope: ScopeState, input: string): BindingResolution =>
		resolveBinding(scope, input, engine.overrides.values());
	const nextId = (): number => engine.nextRegistration++;
	return {
		capability: createCapability(state, resolve, notify, nextId),
		activate: () => activateScope(engine, state),
		dispatch: (input) => dispatchScope(state, input, resolve),
		dispose: () => disposeScope(engine, state),
	};
}

function activateScope(engine: EngineState, state: ScopeState): void {
	if (!state.disposed) engine.active = state.token;
}

function disposeScope(engine: EngineState, state: ScopeState): void {
	if (state.disposed) return;
	state.disposed = true;
	state.defaults.clear();
	state.targets.clear();
	state.actions.clear();
	state.listeners.clear();
	engine.scopes.delete(state.token);
	if (engine.active === state.token) engine.active = undefined;
}

function addOverride(engine: EngineState, selector: OverrideSelector, binding: BindingContribution): Cleanup {
	const id = engine.nextRegistration++;
	engine.overrides.set(id, { selector, binding });
	notifyMatchingScopes(engine.scopes.values(), selector);
	return once(() => {
		if (!engine.overrides.delete(id)) return;
		notifyMatchingScopes(engine.scopes.values(), selector);
	});
}

function dispatchActive(engine: EngineState, input: string): boolean {
	const state = engine.active === undefined ? undefined : engine.scopes.get(engine.active);
	if (state === undefined) return false;
	const resolve = (scope: ScopeState, candidate: string): BindingResolution =>
		resolveBinding(scope, candidate, engine.overrides.values());
	return dispatchScope(state, input, resolve);
}

function dispatchScope(
	state: ScopeState,
	input: string,
	resolve: (state: ScopeState, input: string) => BindingResolution,
): boolean {
	if (state.disposed) return false;
	const binding = resolve(state, input);
	if (binding?.status !== "bound") return false;
	const actions = [...state.actions.values()].flat().reverse();
	for (const action of actions) {
		if (action.id === binding.interaction.action && action.invoke(binding.interaction)) return true;
	}
	const registrations = [...state.targets.values()].flat();
	const matches = registrations.filter((entry) => targetsEqual(entry.target, binding.interaction.target));
	if (matches.length !== 1) return false;
	return matches[0]?.invoke(binding.interaction.action) ?? false;
}

function notify(state: ScopeState): void {
	state.revision += 1;
	for (const listener of state.listeners) {
		try {
			listener();
		} catch {
			// A host listener cannot invalidate an already-applied capability update.
		}
	}
}

function notifyMatchingScopes(scopes: Iterable<ScopeState>, selector: OverrideSelector): void {
	for (const state of scopes) if (selectorMatches(selector, state.metadata)) notify(state);
}

function createCapability(
	state: ScopeState,
	resolve: (state: ScopeState, input: string) => BindingResolution,
	notify: (state: ScopeState) => void,
	nextId: () => number,
): ScopedInteractionCapability {
	return {
		registerTargets: (targets) => {
			assertUnique(targets, ({ target }) => targetKey(target));
			return addRegistration(state, state.targets, targets, nextId(), notify);
		},
		registerActions: (actions) => {
			assertUnique(actions, ({ id }) => id);
			return addRegistration(state, state.actions, actions, nextId(), notify);
		},
		contributeDefaultBindings: (bindings) => addRegistration(state, state.defaults, bindings, nextId(), notify),
		getEffectiveBinding: (input) => (state.disposed ? { input, status: "unbound" } : resolve(state, input)),
		getRevision: () => state.revision,
		subscribe(listener) {
			if (state.disposed) return () => undefined;
			state.listeners.add(listener);
			return once(() => state.listeners.delete(listener));
		},
	};
}

function addRegistration<T>(
	state: ScopeState,
	registrations: Map<number, readonly T[]>,
	items: readonly T[],
	id: number,
	notify: (state: ScopeState) => void,
): Cleanup {
	if (state.disposed) return () => undefined;
	registrations.set(id, [...items]);
	notify(state);
	return once(() => {
		if (!registrations.delete(id) || state.disposed) return;
		notify(state);
	});
}

function resolveBinding(state: ScopeState, input: string, overrides: Iterable<OverrideEntry>): BindingResolution {
	const matchingOverrides = [...overrides]
		.filter((entry) => selectorMatches(entry.selector, state.metadata))
		.map((entry) => entry.binding)
		.filter((binding) => binding.input === input);
	const defaults = [...state.defaults.values()].flat().filter((binding) => binding.input === input);
	const candidates = matchingOverrides.length > 0 ? matchingOverrides : defaults;
	if (candidates.length === 0) return { input, status: "unbound" };
	if (candidates.length > 1) return { input, status: "conflicted" };
	const binding = candidates[0];
	return binding === undefined ? { input, status: "unbound" } : { ...binding, status: "bound" };
}

function selectorMatches(selector: OverrideSelector, metadata: HostScopeMetadata): boolean {
	return (
		(selector.formType === undefined || selector.formType === metadata.formType) &&
		(selector.placement === undefined || selector.placement === metadata.placement)
	);
}

function targetsEqual(left: TargetRegistration["target"], right: TargetRegistration["target"]): boolean {
	if (left.kind !== right.kind) return false;
	return left.kind === "group" ? left.id === (right as typeof left).id : left.path === (right as typeof left).path;
}

function targetKey(target: TargetRegistration["target"]): string {
	return target.kind === "group" ? `group:${target.id}` : `field:${target.path}`;
}

function assertUnique<T>(items: readonly T[], key: (item: T) => string): void {
	const keys = new Set<string>();
	for (const item of items) {
		const value = key(item);
		if (keys.has(value)) throw new Error(`Duplicate registration: ${value}`);
		keys.add(value);
	}
}

function once(cleanup: () => unknown): Cleanup {
	let done = false;
	return () => {
		if (done) return;
		done = true;
		cleanup();
	};
}
