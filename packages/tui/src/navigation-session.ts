import type { InteractionTarget } from "./interaction.js";
import type { FocusNavigationGroup, NavigationModel, NavigationNode } from "./navigation.js";

export type NavigationMode = "group" | "field";

export interface NavigationSnapshot {
	readonly mode: NavigationMode;
	readonly groups: readonly FocusNavigationGroup[];
	readonly entries: readonly NavigationNode[];
	readonly selection: number;
	readonly groupSelection: number;
}

export interface FormNavigationSession {
	getSnapshot(): NavigationSnapshot;
	getSelectedTarget(): InteractionTarget | undefined;
	next(target: InteractionTarget): boolean;
	previous(target: InteractionTarget): boolean;
	advance(target: InteractionTarget): boolean;
	activate(target: InteractionTarget): boolean;
	back(target: InteractionTarget): boolean;
	focus(target: InteractionTarget): boolean;
	subscribe(listener: () => void): () => void;
	dispose(): void;
}

interface NavigationState {
	mode: NavigationMode;
	groupSelection: number;
	fieldSelection: number;
	disposed: boolean;
	readonly listeners: Set<() => void>;
}

/** Experimental pre-1.0 session used to keep the spike and renderer in parity. */
export function createFormNavigationSession(model: NavigationModel): FormNavigationSession {
	const state: NavigationState = {
		mode: "group",
		groupSelection: 0,
		fieldSelection: 0,
		disposed: false,
		listeners: new Set(),
	};
	return {
		getSnapshot: () => snapshot(model, state),
		getSelectedTarget: () => selectedTarget(model, state),
		next: (target) => move(model, state, target, 1),
		previous: (target) => move(model, state, target, -1),
		advance: (target) => move(model, state, target, 1),
		activate: (target) => activate(model, state, target),
		back: (target) => back(model, state, target),
		focus: (target) => focus(model, state, target),
		subscribe: (listener) => subscribe(state, listener),
		dispose: () => dispose(state),
	};
}

function focus(model: NavigationModel, state: NavigationState, target: InteractionTarget): boolean {
	if (state.disposed) return false;
	if (target.kind === "group") {
		const groupIndex = model.groups.findIndex(({ id }) => id === target.id);
		if (groupIndex < 0) return false;
		return change(state, () => {
			state.mode = "group";
			state.groupSelection = groupIndex;
			state.fieldSelection = 0;
		});
	}
	const groupIndex = model.groups.findIndex(({ fields }) => fields.some(({ path }) => path === target.path));
	if (groupIndex < 0) return false;
	const fieldIndex = model.groups[groupIndex]?.fields.findIndex(({ path }) => path === target.path) ?? -1;
	if (fieldIndex < 0) return false;
	return change(state, () => {
		state.mode = "field";
		state.groupSelection = groupIndex;
		state.fieldSelection = fieldIndex;
	});
}

function snapshot(model: NavigationModel, state: NavigationState): NavigationSnapshot {
	const group = currentGroup(model, state);
	return {
		mode: state.mode,
		groups: model.groups,
		entries: state.mode === "group" ? model.groups.map(groupNode) : (group?.fields ?? []),
		selection: state.mode === "group" ? state.groupSelection : state.fieldSelection,
		groupSelection: state.groupSelection,
	};
}

function selectedTarget(model: NavigationModel, state: NavigationState): InteractionTarget | undefined {
	const group = currentGroup(model, state);
	if (group === undefined) return undefined;
	return state.mode === "group" ? { kind: "group", id: group.id } : targetFor(group.fields[state.fieldSelection]);
}

function move(model: NavigationModel, state: NavigationState, target: InteractionTarget, delta: number): boolean {
	if (state.disposed) return false;
	if (!targetsEqual(target, selectedTarget(model, state))) return false;
	const count = state.mode === "group" ? model.groups.length : (currentGroup(model, state)?.fields.length ?? 0);
	if (count === 0) return false;
	if (count === 1) return true;
	return change(state, () => {
		if (state.mode === "group") state.groupSelection = wrap(state.groupSelection, delta, count);
		else state.fieldSelection = wrap(state.fieldSelection, delta, count);
	});
}

function activate(model: NavigationModel, state: NavigationState, target: InteractionTarget): boolean {
	if (state.disposed) return false;
	if (!targetsEqual(target, selectedTarget(model, state))) return false;
	if (state.mode === "field") return target.kind === "field";
	const group = currentGroup(model, state);
	if (group === undefined || group.fields.length === 0) return false;
	return change(state, () => {
		state.mode = "field";
		state.fieldSelection = 0;
	});
}

function back(model: NavigationModel, state: NavigationState, target: InteractionTarget): boolean {
	if (state.disposed) return false;
	if (state.mode !== "field" || !targetsEqual(target, selectedTarget(model, state))) return false;
	return change(state, () => {
		state.mode = "group";
		state.fieldSelection = 0;
	});
}

function change(state: NavigationState, update: () => void): boolean {
	if (state.disposed) return false;
	update();
	for (const listener of state.listeners) listener();
	return true;
}

function subscribe(state: NavigationState, listener: () => void): () => void {
	if (state.disposed) return () => undefined;
	state.listeners.add(listener);
	return once(() => state.listeners.delete(listener));
}

function dispose(state: NavigationState): void {
	if (state.disposed) return;
	state.disposed = true;
	state.listeners.clear();
}

function currentGroup(model: NavigationModel, state: NavigationState): FocusNavigationGroup | undefined {
	return model.groups[state.groupSelection];
}

function groupNode(group: FocusNavigationGroup): NavigationNode {
	return { kind: "group", id: group.id, aliases: [], children: group.fields };
}

function targetFor(node: NavigationNode | undefined): InteractionTarget | undefined {
	if (node === undefined) return undefined;
	return node.kind === "group" ? { kind: "group", id: node.id } : { kind: "field", path: node.path };
}

function targetsEqual(left: InteractionTarget, right: InteractionTarget | undefined): boolean {
	if (right === undefined || left.kind !== right.kind) return false;
	return left.kind === "group" ? left.id === (right as typeof left).id : left.path === (right as typeof left).path;
}

function wrap(current: number, delta: number, count: number): number {
	return (current + delta + count) % count;
}

function once(cleanup: () => unknown): () => void {
	let done = false;
	return () => {
		if (done) return;
		done = true;
		cleanup();
	};
}
