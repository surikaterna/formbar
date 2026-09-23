import type { ResolvedActionState } from "@formbar/declarative";

const invalidProperty = Symbol("invalid-property");

export type StructuralOperation =
	| { readonly type: "append" }
	| { readonly type: "insert"; readonly index: number }
	| { readonly type: "remove"; readonly index: number }
	| { readonly type: "move" | "swap"; readonly from: number; readonly to: number };

export interface StructuralIntent {
	readonly key: string;
	readonly bindingKey: string;
	readonly operation: StructuralOperation;
	readonly actionNodeId: string;
	readonly token: symbol;
}

export interface RepeaterIdentity {
	readonly instanceKey: string;
	readonly bindingKey: string;
}

export interface RepeaterIntentListener {
	apply(intent: StructuralIntent): void;
	finish(intent: StructuralIntent, succeeded: boolean): void;
	reset(): void;
}

export class RepeaterCoordinator {
	private readonly listeners = new Map<string, Set<RepeaterIntentListener>>();
	private readonly appendButtons = new Map<string, Set<HTMLButtonElement>>();
	private readonly instances = new Map<string, Set<string>>();

	register(identity: RepeaterIdentity, listener: RepeaterIntentListener): () => void {
		const key = identityKey(identity);
		const listeners = this.listeners.get(key) ?? new Set();
		listeners.add(listener);
		this.listeners.set(key, listeners);
		const instances = this.instances.get(identity.bindingKey) ?? new Set();
		instances.add(key);
		this.instances.set(identity.bindingKey, instances);
		return () => {
			listeners.delete(listener);
			if (listeners.size) return;
			this.listeners.delete(key);
			instances.delete(key);
			if (!instances.size) this.instances.delete(identity.bindingKey);
		};
	}

	registerAppend(identity: RepeaterIdentity, button: HTMLButtonElement): () => void {
		const key = identityKey(identity);
		const buttons = this.appendButtons.get(key) ?? new Set();
		buttons.add(button);
		this.appendButtons.set(key, buttons);
		return () => {
			buttons.delete(button);
			if (!buttons.size) this.appendButtons.delete(key);
		};
	}

	appendTarget = (key: string): HTMLButtonElement | undefined => {
		for (const button of this.appendButtons.get(key) ?? []) {
			if (!button.disabled && button.isConnected) return button;
		}
		return undefined;
	};

	begin(state: ResolvedActionState, actionNodeId: string, owner?: RepeaterIdentity): StructuralIntent | undefined {
		const operation = structuralOperation(state);
		if (!operation || !state.target) return undefined;
		const targetKey = bindingKey(state.target);
		const key = this.resolveInstance(targetKey, owner);
		if (!key) return undefined;
		const intent = { key, bindingKey: targetKey, operation, actionNodeId, token: Symbol(actionNodeId) };
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

	private resolveInstance(binding: string, owner?: RepeaterIdentity): string | undefined {
		if (owner?.bindingKey === binding) {
			const key = identityKey(owner);
			return this.listeners.has(key) ? key : undefined;
		}
		const instances = this.instances.get(binding);
		return instances?.size === 1 ? instances.values().next().value : undefined;
	}
}

export function bindingKey(binding: { readonly namespace: string; readonly segments: readonly (string | number)[] }) {
	return JSON.stringify([binding.namespace, binding.segments]);
}

export function repeaterIdentity(instanceKey: string, binding: Parameters<typeof bindingKey>[0]): RepeaterIdentity {
	return Object.freeze({ instanceKey, bindingKey: bindingKey(binding) });
}

function identityKey(identity: RepeaterIdentity): string {
	return JSON.stringify([identity.bindingKey, identity.instanceKey]);
}

function structuralOperation(state: ResolvedActionState): StructuralOperation | undefined {
	const payload = state.payload.status === "ready" ? state.payload.value : undefined;
	const fallback = state.instance.scopes.at(-1)?.index;
	if (state.action === "array.append") return { type: "append" };
	if (state.action === "array.insert" && record(payload)) {
		const payloadIndex = ownValue(payload, "index");
		if (payloadIndex === invalidProperty) return undefined;
		const index = payloadIndex === undefined ? fallback : payloadIndex;
		return Number.isSafeInteger(index) ? { type: "insert", index: index as number } : undefined;
	}
	if (state.action === "array.remove") {
		const index = payload === undefined ? fallback : payload;
		return Number.isSafeInteger(index) ? { type: "remove", index: index as number } : undefined;
	}
	if ((state.action === "array.move" || state.action === "array.swap") && record(payload)) {
		const payloadFrom = ownValue(payload, "from");
		if (payloadFrom === invalidProperty) return undefined;
		const from = payloadFrom === undefined ? fallback : payloadFrom;
		const offset = ownValue(payload, "offset");
		if (offset === invalidProperty) return undefined;
		const to = offset === -1 || offset === 1 ? Number(from) + offset : ownValue(payload, "to");
		if (to === invalidProperty) return undefined;
		return Number.isSafeInteger(from) && Number.isSafeInteger(to)
			? { type: state.action.slice(6) as "move" | "swap", from: from as number, to: to as number }
			: undefined;
	}
	return undefined;
}

function ownValue(value: Readonly<Record<string, unknown>>, key: string): unknown | typeof invalidProperty {
	try {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		return !descriptor || "value" in descriptor ? descriptor?.value : invalidProperty;
	} catch {
		return invalidProperty;
	}
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
	try {
		return value !== null && typeof value === "object" && !Array.isArray(value);
	} catch {
		return false;
	}
}
