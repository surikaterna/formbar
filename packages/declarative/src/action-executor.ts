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
import type { ResolvedActionState, RuntimePort, RuntimeResolvedNodeState } from "./runtime-contracts.js";
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
const DROPPED: ActionExecutionResult = Object.freeze({ status: "dropped" });
const MAX_WAITING_INTENTS = 32;

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
	private generation = 0;
	private cancelling = false;

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
		try {
			return this.executeSafe(instanceKey);
		} catch {
			return Promise.resolve(this.fail(instanceKey, "action-failed"));
		}
	};

	private executeSafe(instanceKey: string): Promise<ActionExecutionResult> {
		if (this.disposed || this.cancelling) return Promise.resolve(ABORTED);
		const generation = this.generation;
		this.attach();
		if (this.disposed || generation !== this.generation) return Promise.resolve(ABORTED);
		const state = this.resolvedState(instanceKey);
		if (this.disposed || generation !== this.generation) return Promise.resolve(ABORTED);
		const lane = this.lanes.get(instanceKey) ?? { active: undefined, queue: [] };
		this.lanes.set(instanceKey, lane);
		if (!lane.active) return this.start(instanceKey, lane);
		const diagnostic = preflightAction(this.form, state, state ? this.registry.handlers.has(state.action) : false);
		if (!this.owns(instanceKey, lane)) return Promise.resolve(ABORTED);
		if (diagnostic) return Promise.resolve(Object.freeze({ status: "failed", diagnostic }));
		if (state?.concurrency === "queue") {
			if (lane.queue.length >= MAX_WAITING_INTENTS) return Promise.resolve(DROPPED);
			return new Promise((resolve) => lane.queue.push({ resolve }));
		}
		if (state?.concurrency !== "replace") return Promise.resolve(DROPPED);
		this.cancelActive(instanceKey, lane);
		if (!this.owns(instanceKey, lane)) return Promise.resolve(ABORTED);
		if (lane.active) return Promise.resolve(ABORTED);
		return this.start(instanceKey, lane);
	}

	private start(instanceKey: string, lane: Lane): Promise<ActionExecutionResult> {
		try {
			return this.startSafe(instanceKey, lane);
		} catch {
			if (!this.owns(instanceKey, lane)) return Promise.resolve(ABORTED);
			return this.failStart(instanceKey, lane, "action-failed");
		}
	}

	private startSafe(instanceKey: string, lane: Lane): Promise<ActionExecutionResult> {
		if (!this.owns(instanceKey, lane) || lane.active) return Promise.resolve(ABORTED);
		const state = this.resolvedState(instanceKey);
		if (!this.owns(instanceKey, lane) || lane.active) return Promise.resolve(ABORTED);
		const diagnostic = preflightAction(this.form, state, state ? this.registry.handlers.has(state.action) : false);
		if (!this.owns(instanceKey, lane) || lane.active) return Promise.resolve(ABORTED);
		if (diagnostic) return this.failStart(instanceKey, lane, diagnostic);
		const token = { controller: new AbortController() };
		lane.active = token;
		this.setState(instanceKey, Object.freeze({ status: "pending" }));
		if (!this.owns(instanceKey, lane) || lane.active !== token) return Promise.resolve(ABORTED);
		return this.run(instanceKey, lane, token);
	}

	private failStart(instanceKey: string, lane: Lane, diagnostic: ActionDiagnosticCode) {
		const result = this.fail(instanceKey, diagnostic);
		this.drain(instanceKey, lane);
		return Promise.resolve(result);
	}

	private async run(instanceKey: string, lane: Lane, token: RunToken): Promise<ActionExecutionResult> {
		const diagnostic = await this.raceAbort(token, () => this.invoke(instanceKey, token));
		if (lane.active !== token) return ABORTED;
		lane.active = undefined;
		const result = this.finish(instanceKey, diagnostic);
		if (!this.owns(instanceKey, lane)) return ABORTED;
		this.drain(instanceKey, lane);
		return result;
	}

	private owns(instanceKey: string, lane: Lane): boolean {
		return !this.disposed && this.lanes.get(instanceKey) === lane;
	}

	private drain(instanceKey: string, lane: Lane): void {
		if (!this.owns(instanceKey, lane) || lane.active) return;
		const next = lane.queue.shift();
		if (next) void this.start(instanceKey, lane).then(next.resolve);
		else this.lanes.delete(instanceKey);
	}

	private async invoke(instanceKey: string, token: RunToken): Promise<ActionDiagnosticCode | undefined> {
		const state = actionState(this.runtime.getNode(instanceKey));
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
		const snapshot = this.runtime.getSnapshot();
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
		if (!this.lanes.has(instanceKey) || this.owns(instanceKey, lane)) {
			this.setState(instanceKey, Object.freeze({ status: "idle" }));
		}
	}

	private cancelAll(except?: RunToken): void {
		this.generation++;
		const lanes = [...this.lanes];
		this.lanes.clear();
		if (except) {
			const retained = lanes.find(([, lane]) => lane.active === except);
			if (retained) this.lanes.set(retained[0], retained[1]);
		}
		const wasCancelling = this.cancelling;
		this.cancelling = true;
		try {
			for (const [instanceKey, lane] of lanes) {
				for (const intent of lane.queue.splice(0)) intent.resolve(ABORTED);
				if (lane.active === except) continue;
				this.cancelActive(instanceKey, lane);
			}
		} finally {
			this.cancelling = wasCancelling;
		}
	}

	private resolvedState(instanceKey: string): ResolvedActionState | undefined {
		return actionState(this.runtime.getNode(instanceKey));
	}

	private readState(instanceKey: string): ActionExecutionState {
		try {
			return this.readStateSafe(instanceKey);
		} catch {
			const failed = Object.freeze({ status: "failed" as const, diagnostic: "action-failed" as const });
			this.states.set(instanceKey, failed);
			return failed;
		}
	}

	private readStateSafe(instanceKey: string): ActionExecutionState {
		const current = this.states.get(instanceKey);
		const state = this.resolvedState(instanceKey);
		const diagnostic = preflightAction(this.form, state, state ? this.registry.handlers.has(state.action) : false);
		if (diagnostic) {
			if (current?.availability === diagnostic) return current;
			const unavailable = Object.freeze({
				status: current?.status ?? ("idle" as const),
				...(current?.diagnostic ? { diagnostic: current.diagnostic } : {}),
				availability: diagnostic,
			});
			this.states.set(instanceKey, unavailable);
			return unavailable;
		}
		if (current && !current.availability) return current;
		if (current) {
			const available = Object.freeze({
				status: current.status,
				...(current.diagnostic ? { diagnostic: current.diagnostic } : {}),
			});
			this.states.set(instanceKey, available);
			return available;
		}
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

function actionState(state: RuntimeResolvedNodeState | undefined): ResolvedActionState | undefined {
	return state?.type === "action" && "action" in state && "payload" in state ? state : undefined;
}

export function createActionExecutor<TData, TUi>(options: CreateActionExecutorOptions<TData, TUi>): ActionExecutor {
	return new DeclarativeActionExecutor(options as CreateActionExecutorOptions);
}
