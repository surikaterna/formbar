import type { ResolvedActionState } from "@formbar/declarative";

export type StructuralOperation =
	| { readonly type: "append" }
	| { readonly type: "insert"; readonly index: number }
	| { readonly type: "remove"; readonly index: number }
	| { readonly type: "move" | "swap"; readonly from: number; readonly to: number };

export interface StructuralIntent {
	readonly key: string;
	readonly operation: StructuralOperation;
	readonly actionNodeId: string;
	readonly token: symbol;
}

export interface RepeaterIntentListener {
	apply(intent: StructuralIntent): void;
	finish(intent: StructuralIntent, succeeded: boolean): void;
	reset(): void;
}

export class RepeaterCoordinator {
	private readonly listeners = new Map<string, Set<RepeaterIntentListener>>();

	register(key: string, listener: RepeaterIntentListener): () => void {
		const listeners = this.listeners.get(key) ?? new Set();
		listeners.add(listener);
		this.listeners.set(key, listeners);
		return () => {
			listeners.delete(listener);
			if (!listeners.size) this.listeners.delete(key);
		};
	}

	begin(state: ResolvedActionState, actionNodeId: string): StructuralIntent | undefined {
		const operation = structuralOperation(state);
		if (!operation || !state.target) return undefined;
		const key = bindingKey(state.target);
		const intent = { key, operation, actionNodeId, token: Symbol(actionNodeId) };
		for (const listener of this.listeners.get(key) ?? []) listener.apply(intent);
		return intent;
	}

	finish(intent: StructuralIntent | undefined, succeeded: boolean): void {
		if (!intent) return;
		for (const listener of this.listeners.get(intent.key) ?? []) listener.finish(intent, succeeded);
	}

	reset(): void {
		for (const listeners of this.listeners.values()) for (const listener of listeners) listener.reset();
	}
}

export function bindingKey(binding: { readonly namespace: string; readonly segments: readonly (string | number)[] }) {
	return JSON.stringify([binding.namespace, binding.segments]);
}

function structuralOperation(state: ResolvedActionState): StructuralOperation | undefined {
	const payload = state.payload.status === "ready" ? state.payload.value : undefined;
	const fallback = state.instance.scopes.at(-1)?.index;
	if (state.action === "array.append") return { type: "append" };
	if (state.action === "array.insert" && record(payload)) {
		const index = payload.index === undefined ? fallback : payload.index;
		return Number.isSafeInteger(index) ? { type: "insert", index: index as number } : undefined;
	}
	if (state.action === "array.remove") {
		const index = payload === undefined ? fallback : payload;
		return Number.isSafeInteger(index) ? { type: "remove", index: index as number } : undefined;
	}
	if ((state.action === "array.move" || state.action === "array.swap") && record(payload)) {
		const from = payload.from === undefined ? fallback : payload.from;
		const to = payload.offset === -1 || payload.offset === 1 ? Number(from) + payload.offset : payload.to;
		return Number.isSafeInteger(from) && Number.isSafeInteger(to)
			? { type: state.action.slice(6) as "move" | "swap", from: from as number, to: to as number }
			: undefined;
	}
	return undefined;
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
