import type { ReferenceResolution } from "kuery/expression";
import { isAsync, synchronousValue } from "./async.js";
import { CallbackBoundary } from "./callback-boundary.js";
import type {
	Authorization,
	JsonValue,
	NamespaceProvider,
	Result,
	ServiceOptions,
	Setter,
	StateRef,
	WriteResult,
} from "./contracts.js";
import { copyJson } from "./json.js";
import { dependencyKey, readOwn, validateRef } from "./references.js";
import { ExpressionError, failure } from "./result.js";

export class Capabilities {
	readonly lifecycle = new CallbackBoundary();
	readonly namespaces = new Map<string, NamespaceProvider>();
	readonly listeners = new Set<() => void>();
	private cleanups: (() => void)[] = [];
	private epoch = 0;
	private connectionFailed = false;
	private readonly identities = new WeakMap<object, object>();
	disposed = false;
	private readonly authorize: Authorization;

	constructor(options: ServiceOptions) {
		this.authorize = options.authorize ?? (() => true);
		for (const [name, provider] of Object.entries(options.namespaces ?? {})) this.namespaces.set(name, provider);
	}

	check(ref: StateRef, operation: "read" | "write", providers = this.namespaces): NamespaceProvider {
		validateRef(ref);
		if (this.disposed) throw new ExpressionError("disposed");
		if (this.connectionFailed) throw new ExpressionError("adapter");
		const provider = providers.get(ref.namespace);
		if (!provider || synchronousValue(this.authorize(ref, operation)) !== true) throw new ExpressionError("denied");
		if (synchronousValue(provider.isDisposed?.())) throw new ExpressionError("disposed");
		if (operation === "write" && !provider.write) throw new ExpressionError("read-only");
		return provider;
	}

	capture(refs: readonly StateRef[], providers = this.namespaces): ReadonlyMap<string, ReferenceResolution> {
		const authorized = new Map<string, NamespaceProvider>();
		let failed = false;
		let firstFailure: unknown;
		for (const ref of refs) {
			try {
				authorized.set(dependencyKey(ref), this.check(ref, "read", providers));
			} catch (error) {
				if (!failed) firstFailure = error;
				failed = true;
			}
		}
		if (failed) throw firstFailure instanceof ExpressionError ? firstFailure : new ExpressionError("adapter");
		return this.captureAuthorized(refs, authorized);
	}

	private captureAuthorized(
		refs: readonly StateRef[],
		providers: ReadonlyMap<string, NamespaceProvider>,
	): ReadonlyMap<string, ReferenceResolution> {
		const roots = new Map<string, unknown>();
		const frame = new Map<string, ReferenceResolution>();
		for (const ref of refs) {
			const provider = providers.get(dependencyKey(ref));
			if (!provider) throw new ExpressionError("denied");
			if (!roots.has(ref.namespace)) roots.set(ref.namespace, synchronousValue(provider.getSnapshot()));
			frame.set(dependencyKey(ref), captureValue(roots.get(ref.namespace), ref));
		}
		return frame;
	}

	target(ref: StateRef): readonly unknown[] {
		const provider = this.check(ref, "read");
		this.check(ref, "write");
		const parent = readOwn(synchronousValue(provider.getSnapshot()), ref.segments.slice(0, -1));
		if (!parent || typeof parent !== "object") throw new ExpressionError("missing");
		if (!this.identities.has(parent)) this.identities.set(parent, {});
		return [provider, synchronousValue(provider.getVersion?.()), this.epoch, this.identities.get(parent)];
	}

	writable(ref: StateRef, active: () => boolean = () => true): Result<Setter> {
		try {
			const target = this.target(ref);
			return { ok: true, value: (value) => this.write(ref, target, value, active) };
		} catch (error) {
			return capabilityFailure(error);
		}
	}

	private write(ref: StateRef, target: readonly unknown[], value: JsonValue, active: () => boolean): WriteResult {
		try {
			if (this.disposed) return failure("disposed");
			if (synchronousValue(active()) !== true) return failure("stale");
			const nextValue = copyJson(value);
			const next = this.target(ref);
			if (next.some((part, index) => !Object.is(part, target[index]))) return failure("stale");
			const provider = this.check(ref, "write");
			const result = provider.write?.(ref.segments, nextValue);
			if (isAsync(result)) return failure("adapter");
			return result && typeof result.ok === "boolean" ? result : failure("adapter");
		} catch (error) {
			return capabilityFailure(error);
		}
	}

	subscribe = (listener: () => void): (() => void) => {
		if (this.disposed) return () => {};
		this.listeners.add(listener);
		try {
			if (this.listeners.size === 1) this.connect();
		} catch (error) {
			this.listeners.delete(listener);
			throw error;
		}
		return () => {
			if (!this.listeners.delete(listener)) return;
			if (!this.listeners.size) this.disconnect();
		};
	};

	private connect(): void {
		this.connectionFailed = false;
		try {
			for (const provider of new Set(this.namespaces.values())) this.attach(provider);
		} catch {
			this.connectionFailed = true;
			this.lifecycle.reportFailure();
			this.disconnect();
			throw new ExpressionError("adapter");
		}
	}

	private attach(provider: NamespaceProvider): void {
		if (this.disposed || !this.listeners.size) return;
		const cleanup = synchronousValue(provider.subscribe(this.emit));
		if (typeof cleanup !== "function") throw new ExpressionError("adapter");
		if (this.disposed || !this.listeners.size) this.lifecycle.run(cleanup);
		else this.cleanups.push(cleanup);
	}

	private disconnect(): void {
		const cleanups = this.cleanups.splice(0);
		if (!this.lifecycle.runAll(cleanups)) this.connectionFailed = true;
	}

	emit = (): void => {
		this.lifecycle.runAll([...this.listeners]);
	};
	invalidateAuthorization(): void {
		this.epoch++;
		this.emit();
	}

	registerNamespace(name: string, provider?: NamespaceProvider): void {
		validateRef({ namespace: name, segments: [] });
		if (this.disposed) throw new ExpressionError("disposed");
		this.disconnect();
		if (this.disposed) return;
		this.connectionFailed = false;
		if (provider) this.namespaces.set(name, provider);
		else this.namespaces.delete(name);
		try {
			if (this.listeners.size) this.connect();
		} finally {
			this.invalidateAuthorization();
		}
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		const listeners = [...this.listeners];
		this.listeners.clear();
		this.namespaces.clear();
		this.disconnect();
		this.lifecycle.runAll(listeners);
	}
}

function captureValue(root: unknown, ref: StateRef): ReferenceResolution {
	try {
		return { found: true, value: copyJson(readOwn(root, ref.segments)) };
	} catch (error) {
		if (error instanceof ExpressionError && error.code === "missing") return { found: false };
		throw error;
	}
}

export function capabilityFailure<T = never>(error: unknown): Result<T> {
	return failure(error instanceof ExpressionError ? error.code : "adapter");
}
