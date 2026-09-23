import type { FormApi } from "@formbar/core";
import { CallbackBoundary } from "@formbar/expressions";
import { preflightAction, runBuiltIn } from "./action-builtins.js";
import { BUILT_IN_ACTIONS, normalizeActions } from "./action-registry.js";
import type {
	ActionDiagnosticCode,
	ActionExecutionResult,
	ActionExecutionState,
	ActionExecutor,
	ActionHandler,
	CreateActionExecutorOptions,
} from "./actions.js";
import type { ResolvedActionState, RuntimePort, RuntimeSnapshot } from "./runtime-contracts.js";
import { RuntimeObservation } from "./runtime-observation.js";

interface Intent {
	readonly resolve: (result: ActionExecutionResult) => void;
}

interface RunToken {
	readonly controller: AbortController;
}

interface Lane {
	active: RunToken | undefined;
	readonly queue: Intent[];
}

const ABORTED: ActionExecutionResult = Object.freeze({ status: "aborted", diagnostic: "action-aborted" });

class DeclarativeActionExecutor implements ActionExecutor {
	private readonly form: FormApi<unknown, unknown>;
	private readonly runtime: RuntimePort;
	private readonly registry;
	private readonly lifecycle = new CallbackBoundary();
	private readonly lanes = new Map<string, Lane>();
	private readonly states = new Map<string, ActionExecutionState>();
	private readonly listeners = new Map<string, Set<() => void>>();
	private readonly observations = new Set<RuntimeObservation<ActionExecutionState>>();
	private readonly cleanup: (() => void)[] = [];
	private resetToken: RunToken | undefined;
	private attached = false;
	private disposed = false;

	constructor(options: CreateActionExecutorOptions) {
		this.form = options.form;
		this.runtime = options.runtime;
		this.registry = normalizeActions(options.actions);
		this.disposed = this.runtime.isDisposed() || this.form.isDisposed();
	}

	getDiagnostics = () => this.registry.diagnostics;

	isDisposed = (): boolean => this.disposed;

	observe = (instanceKey: string): RuntimeObservation<ActionExecutionState> => {
		const observation = new RuntimeObservation(
			() => this.readState(instanceKey),
			(listener) => this.subscribe(instanceKey, listener),
			(current) => this.observations.delete(current),
		);
		this.observations.add(observation);
		if (this.disposed) observation.dispose();
		return observation;
	};

	execute = (instanceKey: string): Promise<ActionExecutionResult> => {
		if (this.disposed) return Promise.resolve(ABORTED);
		this.attach();
		if (this.disposed) return Promise.resolve(ABORTED);
		const state = this.resolvedState(instanceKey);
		const lane = this.lanes.get(instanceKey) ?? { active: undefined, queue: [] };
		this.lanes.set(instanceKey, lane);
		if (!lane.active) return this.start(instanceKey, lane);
		if (state?.concurrency === "queue") return new Promise((resolve) => lane.queue.push({ resolve }));
		if (state?.concurrency !== "replace") return Promise.resolve(Object.freeze({ status: "dropped" }));
		this.cancelActive(instanceKey, lane);
		return this.start(instanceKey, lane);
	};

	private start(instanceKey: string, lane: Lane): Promise<ActionExecutionResult> {
		const state = this.resolvedState(instanceKey);
		const diagnostic = preflightAction(this.form, state, state ? this.registry.handlers.has(state.action) : false);
		if (diagnostic) return this.failStart(instanceKey, lane, diagnostic);
		const token = { controller: new AbortController() };
		lane.active = token;
		this.setState(instanceKey, Object.freeze({ status: "pending" }));
		return this.run(instanceKey, lane, token);
	}

	private failStart(instanceKey: string, lane: Lane, diagnostic: ActionDiagnosticCode) {
		const result = this.fail(instanceKey, diagnostic);
		const next = lane.queue.shift();
		if (next) void this.start(instanceKey, lane).then(next.resolve);
		else this.lanes.delete(instanceKey);
		return Promise.resolve(result);
	}

	private async run(instanceKey: string, lane: Lane, token: RunToken): Promise<ActionExecutionResult> {
		const diagnostic = await this.raceAbort(token, () => this.invoke(instanceKey, token));
		if (lane.active !== token) return ABORTED;
		lane.active = undefined;
		const result = this.finish(instanceKey, diagnostic);
		const next = lane.queue.shift();
		if (next) void this.start(instanceKey, lane).then(next.resolve);
		else if (!lane.active) this.lanes.delete(instanceKey);
		return result;
	}

	private async invoke(instanceKey: string, token: RunToken): Promise<ActionDiagnosticCode | undefined> {
		const snapshot = this.runtime.getSnapshot();
		const state = this.actionFromSnapshot(snapshot, instanceKey);
		const diagnostic = preflightAction(this.form, state, state ? this.registry.handlers.has(state.action) : false);
		if (diagnostic || !state) return diagnostic ?? "action-unavailable";
		if (BUILT_IN_ACTIONS.has(state.action)) {
			return runBuiltIn({
				form: this.form,
				state,
				signal: token.controller.signal,
				reset: () => this.reset(state.instance.instanceKey, token),
			});
		}
		const handler = this.registry.handlers.get(state.action) as ActionHandler;
		const request = Object.freeze({
			action: state.action,
			nodeId: state.instance.nodeId,
			instanceKey: state.instance.instanceKey,
			...(state.payload.status === "ready" ? { payload: state.payload.value } : {}),
		});
		await handler(request, Object.freeze({ runtime: this.runtime, snapshot, signal: token.controller.signal }));
		return undefined;
	}

	private raceAbort(token: RunToken, operation: () => Promise<ActionDiagnosticCode | undefined>) {
		const task = Promise.resolve()
			.then(operation)
			.catch(() => "action-failed" as const);
		if (token.controller.signal.aborted) return Promise.resolve("action-aborted" as const);
		return new Promise<ActionDiagnosticCode | undefined>((resolve) => {
			const aborted = () => resolve("action-aborted");
			token.controller.signal.addEventListener("abort", aborted, { once: true });
			void task.then((result) => {
				token.controller.signal.removeEventListener("abort", aborted);
				resolve(result);
			});
		});
	}

	private finish(instanceKey: string, diagnostic: ActionDiagnosticCode | undefined): ActionExecutionResult {
		if (diagnostic === "action-aborted") {
			this.setState(instanceKey, Object.freeze({ status: "idle" }));
			return ABORTED;
		}
		if (diagnostic) return this.fail(instanceKey, diagnostic);
		this.setState(instanceKey, Object.freeze({ status: "succeeded" }));
		return Object.freeze({ status: "completed" });
	}

	private fail(instanceKey: string, diagnostic: ActionDiagnosticCode): ActionExecutionResult {
		this.setState(instanceKey, Object.freeze({ status: "failed", diagnostic }));
		return Object.freeze({ status: "failed", diagnostic });
	}

	private reset(instanceKey: string, token: RunToken): void {
		this.resetToken = token;
		this.cancelAll(token);
		try {
			this.form.reset();
		} finally {
			this.resetToken = undefined;
			this.notifyKey(instanceKey);
		}
	}

	private onReset = (): void => {
		this.cancelAll(this.resetToken);
	};

	private cancelActive(instanceKey: string, lane: Lane): void {
		const active = lane.active;
		lane.active = undefined;
		active?.controller.abort();
		this.setState(instanceKey, Object.freeze({ status: "idle" }));
	}

	private cancelAll(except?: RunToken): void {
		for (const [instanceKey, lane] of this.lanes) {
			for (const intent of lane.queue.splice(0)) intent.resolve(ABORTED);
			if (lane.active === except) continue;
			this.cancelActive(instanceKey, lane);
			this.lanes.delete(instanceKey);
		}
	}

	private resolvedState(instanceKey: string): ResolvedActionState | undefined {
		return this.actionFromSnapshot(this.runtime.getSnapshot(), instanceKey);
	}

	private actionFromSnapshot(snapshot: RuntimeSnapshot, instanceKey: string): ResolvedActionState | undefined {
		const state = snapshot.nodes.find((node) => node.instance.instanceKey === instanceKey);
		return state?.type === "action" && "action" in state && "payload" in state ? state : undefined;
	}

	private readState(instanceKey: string): ActionExecutionState {
		const current = this.states.get(instanceKey);
		if (current?.status === "pending") return current;
		const state = this.resolvedState(instanceKey);
		const diagnostic = preflightAction(this.form, state, state ? this.registry.handlers.has(state.action) : false);
		if (diagnostic) {
			if (current?.status === "idle" && current.diagnostic === diagnostic) return current;
			const unavailable = Object.freeze({ status: "idle" as const, diagnostic });
			this.states.set(instanceKey, unavailable);
			return unavailable;
		}
		if (current && !(current.status === "idle" && current.diagnostic)) return current;
		const idle = Object.freeze({ status: "idle" as const });
		this.states.set(instanceKey, idle);
		return idle;
	}

	private setState(instanceKey: string, state: ActionExecutionState): void {
		this.states.set(instanceKey, state);
		this.notifyKey(instanceKey);
	}

	private subscribe(instanceKey: string, listener: () => void): () => void {
		if (this.disposed) return () => {};
		this.attach();
		if (this.disposed) return () => {};
		const listeners = this.listeners.get(instanceKey) ?? new Set();
		listeners.add(listener);
		this.listeners.set(instanceKey, listeners);
		return () => {
			listeners.delete(listener);
			if (!listeners.size) this.listeners.delete(instanceKey);
		};
	}

	private notifyKey(instanceKey: string): void {
		this.lifecycle.runAll([...(this.listeners.get(instanceKey) ?? [])]);
	}

	private notifyAll = (): void => {
		for (const instanceKey of this.listeners.keys()) this.notifyKey(instanceKey);
	};

	private attach(): void {
		if (this.attached || this.disposed) return;
		this.attached = true;
		this.addCleanup(this.runtime.subscribe(this.notifyAll));
		this.addCleanup(this.runtime.onDispose(this.dispose));
		this.addCleanup(this.form.onDispose(this.dispose));
		this.addCleanup(this.form.onReset(this.onReset));
	}

	private addCleanup(cleanup: () => void): void {
		if (this.disposed) this.lifecycle.run(cleanup);
		else this.cleanup.push(cleanup);
	}

	dispose = (): void => {
		if (this.disposed) return;
		this.disposed = true;
		this.cancelAll();
		this.lifecycle.runAll(this.cleanup.splice(0));
		for (const observation of [...this.observations]) observation.dispose();
		this.observations.clear();
		this.listeners.clear();
		this.states.clear();
	};
}

export function createActionExecutor<TData, TUi>(options: CreateActionExecutorOptions<TData, TUi>): ActionExecutor {
	return new DeclarativeActionExecutor(options as CreateActionExecutorOptions);
}
