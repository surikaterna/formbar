import { createCoreExpressionNamespaces } from "@formbar/core";
import type { FormApi } from "@formbar/core";
import { CallbackBoundary, createExpressionService, failure } from "@formbar/expressions";
import type { JsonValue, Observation, Segment, StateRef, WriteResult } from "@formbar/expressions";
import type { ValidatedFormDefinition } from "./definition.js";
import { RuntimeObservation } from "./runtime-observation.js";
import { projectRuntime } from "./runtime-projection.js";
import type {
	ResolvedNodeState,
	RuntimeFieldBaseline,
	RuntimeFormStatus,
	RuntimePort,
	RuntimeSnapshot,
} from "./runtime-contracts.js";

export interface CreateFormRuntimeOptions<TData = unknown, TUi = unknown> {
	readonly form: FormApi<TData, TUi>;
	readonly definition: ValidatedFormDefinition;
	readonly baseline?: readonly RuntimeFieldBaseline[];
}

class DeclarativeRuntime implements RuntimePort {
	private readonly listeners = new Set<() => void>();
	private readonly observations = new Set<RuntimeObservation<unknown>>();
	private readonly lifecycle = new CallbackBoundary();
	private readonly namespaces;
	private readonly expressions;
	private cleanup: (() => void) | undefined;
	private snapshot: RuntimeSnapshot | undefined;
	private disposed = false;

	constructor(private readonly options: CreateFormRuntimeOptions) {
		this.namespaces = createCoreExpressionNamespaces(options.form);
		this.expressions = createExpressionService({ namespaces: this.namespaces });
	}

	getSnapshot = (): RuntimeSnapshot => {
		const next = projectRuntime({
			form: this.options.form,
			definition: this.options.definition,
			...(this.options.baseline ? { baseline: this.options.baseline } : {}),
		});
		if (!this.snapshot || JSON.stringify(this.snapshot) !== JSON.stringify(next)) this.snapshot = next;
		return this.snapshot;
	};

	read = (reference: StateRef): JsonValue | undefined => {
		const compiled = this.expressions.compile({ kind: "ref", ref: reference });
		if (!compiled.ok) return undefined;
		const result = this.expressions.evaluate(compiled.value);
		return result.ok ? result.value : undefined;
	};

	write = (namespace: string, segments: readonly Segment[], value: JsonValue): WriteResult => {
		const compiled = this.expressions.compile({ kind: "ref", ref: { namespace, segments } });
		if (!compiled.ok) return failure(compiled.diagnostics[0]?.code ?? "backend");
		const setter = this.expressions.resolveWritable(compiled.value);
		return setter.ok ? setter.value(value) : failure(setter.diagnostics[0]?.code ?? "backend");
	};

	subscribe = (listener: () => void): (() => void) => {
		if (this.disposed) return () => {};
		this.listeners.add(listener);
		if (!this.cleanup) this.attach();
		return () => {
			if (!this.listeners.delete(listener) || this.listeners.size) return;
			this.detach();
		};
	};

	observeForm = (): Observation<RuntimeFormStatus> => this.observation(() => this.getSnapshot().form);

	observeNode = (instanceKey: string): Observation<ResolvedNodeState | undefined> =>
		this.observation(() => this.getSnapshot().nodes.find((node) => node.instance.instanceKey === instanceKey));

	private observation<T>(read: () => T): Observation<T> {
		const observation = new RuntimeObservation(read, this.subscribe);
		this.observations.add(observation as RuntimeObservation<unknown>);
		return observation;
	}

	private attach(): void {
		const state = this.options.form.subscribe(this.notify);
		const disposal = this.options.form.onDispose(this.dispose);
		this.cleanup = () => this.lifecycle.runAll([state, disposal]);
	}

	private notify = (): void => {
		this.snapshot = undefined;
		this.lifecycle.runAll([...this.listeners]);
	};

	private detach(): void {
		const cleanup = this.cleanup;
		this.cleanup = undefined;
		if (cleanup) this.lifecycle.run(cleanup);
	}

	dispose = (): void => {
		if (this.disposed) return;
		this.disposed = true;
		this.detach();
		for (const observation of this.observations) observation.dispose();
		this.observations.clear();
		this.listeners.clear();
		this.expressions.dispose();
	};
}

export function createFormRuntime<TData, TUi>(options: CreateFormRuntimeOptions<TData, TUi>): RuntimePort {
	return new DeclarativeRuntime(options as CreateFormRuntimeOptions);
}
