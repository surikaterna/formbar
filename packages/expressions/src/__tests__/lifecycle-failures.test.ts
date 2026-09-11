import { describe, expect, it, vi } from "vitest";
import { namespace, ref } from "../../../../test/expression-fixtures.js";
import { createExpressionService, failure } from "../index.js";
import type { ExpressionBackend, NamespaceProvider } from "../index.js";
import { createObservation } from "../observation.js";

const identity: ExpressionBackend = {
	id: "identity",
	compile: (expression) => ({
		ok: true,
		value: {
			evaluate: (read) => (expression.kind === "ref" ? read(expression.ref) : null),
		},
	}),
};

function resource(log: string[], name: string, fail = false) {
	const listeners = new Set<() => void>();
	const snapshot = { x: name };
	const provider: NamespaceProvider = {
		getSnapshot: () => snapshot,
		write: () => ({ ok: true }),
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
				log.push(name);
				if (fail) throw new Error("SECRET cleanup");
			};
		},
	};
	return { provider, listeners };
}

describe("R2 contained lifecycle failures", () => {
	it("does not reactivate a pre-subscription setter after failed setup and retry", () => {
		const state = namespace({ x: 1 });
		let first = true;
		const service = createExpressionService({
			backend: identity,
			namespaces: {
				data: {
					...state.provider,
					subscribe(listener) {
						if (first) {
							first = false;
							throw new Error("SECRET setup");
						}
						return state.provider.subscribe(listener);
					},
				},
			},
		});
		const binding = service.resolveProps({ value: { mode: "write", expression: ref("x") } });
		const abandoned = binding.getSnapshot().setters.value;
		expect(() => binding.subscribe(() => {})).toThrow(/^adapter$/);
		binding.subscribe(() => {});
		expect(abandoned(2)).toEqual(failure("stale"));
		expect(binding.getSnapshot().setters.value(2).ok).toBe(true);
		service.dispose();
	});
	it("attempts all provider cleanups and listeners, clears values, and revokes every setter", () => {
		const log: string[] = [];
		const first = resource(log, "secret", true);
		const second = resource(log, "other");
		const service = createExpressionService({
			backend: identity,
			namespaces: { data: first.provider, other: second.provider },
		});
		const binding = service.resolveProps({ value: { mode: "write", expression: ref("x") } });
		const another = service.resolveProps({ label: { mode: "read", expression: ref("x") } });
		binding.subscribe(() => {
			service.dispose();
			throw new Error("SECRET listener");
		});
		const notified = vi.fn();
		binding.subscribe(notified);
		another.subscribe(notified);
		const setter = binding.getSnapshot().setters.value;
		another.getSnapshot();
		expect(() => service.dispose()).not.toThrow();
		expect(log).toEqual(["secret", "other"]);
		expect(notified).toHaveBeenCalledTimes(2);
		expect(first.listeners.size + second.listeners.size).toBe(0);
		expect(binding.getSnapshot().values.value).toBeUndefined();
		expect(another.getSnapshot().values.label).toBeUndefined();
		expect(setter(2)).toEqual(failure("disposed"));
		expect(service.getLifecycleDiagnostics()).toEqual([{ code: "adapter" }]);
		expect(binding.getLifecycleDiagnostics()).toBe(service.getLifecycleDiagnostics());
		service.dispose();
		expect(log).toHaveLength(2);
		expect(notified).toHaveBeenCalledTimes(2);
	});
	it("finishes replacement despite cleanup/listener failures and blocks the former target", () => {
		const log: string[] = [];
		const old = resource(log, "old", true);
		const other = resource(log, "other");
		const next = resource(log, "next");
		const service = createExpressionService({
			backend: identity,
			namespaces: { data: old.provider, other: other.provider },
		});
		const binding = service.resolveProps({ value: { mode: "write", expression: ref("x") } });
		binding.subscribe(() => {
			throw new Error("SECRET notification");
		});
		const notified = vi.fn();
		binding.subscribe(notified);
		const stale = binding.getSnapshot().setters.value;
		expect(() => service.registerNamespace("data", next.provider)).not.toThrow();
		expect(log).toEqual(["old", "other"]);
		expect(old.listeners.size).toBe(0);
		expect(next.listeners.size).toBe(1);
		expect(binding.getSnapshot().values.value).toBe("next");
		expect(stale(2)).toEqual(failure("stale"));
		expect(notified).toHaveBeenCalledTimes(1);
		expect(service.getLifecycleDiagnostics()).toEqual([{ code: "adapter" }]);
		service.dispose();
		expect(other.listeners.size + next.listeners.size).toBe(0);
	});
	it("finalizes unsubscribe before cleanup, then allows a fresh binding without reviving old setters", () => {
		const log: string[] = [];
		const first = resource(log, "first", true);
		const second = resource(log, "second");
		const service = createExpressionService({
			backend: identity,
			namespaces: { data: first.provider, other: second.provider },
		});
		const binding = service.resolveProps({ value: { mode: "write", expression: ref("x") } });
		const stop = binding.subscribe(() => {});
		const setter = binding.getSnapshot().setters.value;
		expect(() => stop()).not.toThrow();
		stop();
		expect(log).toEqual(["first", "second"]);
		expect(setter(2)).toEqual(failure("stale"));
		expect(binding.getSnapshot().values.value).toBeUndefined();
		const fresh = binding.subscribe(() => {});
		expect(binding.getSnapshot().values.value).toBe("first");
		expect(binding.getSnapshot().setters.value(2).ok).toBe(true);
		expect(setter(2)).toEqual(failure("stale"));
		fresh();
		service.dispose();
	});
	it("contains direct observation cleanup failures and completes idempotent reentrant disposal", () => {
		let cleanupCount = 0;
		const binding = createObservation(
			(_, disposed) => (disposed ? undefined : "secret"),
			() => () => {
				cleanupCount++;
				binding.dispose();
				throw new Error("SECRET cleanup");
			},
		);
		binding.subscribe(() => {
			binding.dispose();
			throw new Error("SECRET listener");
		});
		const notified = vi.fn();
		binding.subscribe(notified);
		expect(binding.getSnapshot()).toBe("secret");
		expect(() => binding.dispose()).not.toThrow();
		expect(binding.getSnapshot()).toBeUndefined();
		expect(binding.getLifecycleDiagnostics()).toEqual([{ code: "adapter" }]);
		expect(notified).toHaveBeenCalledTimes(1);
		binding.dispose();
		expect(cleanupCount).toBe(1);
	});
	it("disposal wins during subscribe and replacement, without retaining late cleanup handles", () => {
		let cleanupCount = 0;
		const service = createExpressionService({ backend: identity });
		service.registerNamespace("data", {
			...namespace({ x: 1 }).provider,
			subscribe() {
				service.dispose();
				return () => {
					cleanupCount++;
				};
			},
		});
		const binding = service.resolveProps({ value: { mode: "read", expression: ref("x") } });
		binding.subscribe(() => {});
		expect(binding.getSnapshot().values.value).toBeUndefined();
		expect(cleanupCount).toBe(1);
		const another = createExpressionService({ backend: identity });
		another.registerNamespace("data", { ...namespace({ x: 1 }).provider, subscribe: () => () => another.dispose() });
		another.resolveProps({ value: { mode: "read", expression: ref("x") } }).subscribe(() => {});
		another.registerNamespace("data", namespace({ x: 2 }).provider);
		expect(another.capabilities.namespaces.size).toBe(0);
		binding.dispose();
	});
	it("notifies all bindings on revocation even when the first consumer throws", () => {
		let allowed = true;
		const service = createExpressionService({
			backend: identity,
			namespaces: { data: namespace({ x: "secret" }).provider },
			authorize: () => allowed,
		});
		const first = service.resolveProps({ value: { mode: "read", expression: ref("x") } });
		const second = service.resolveProps({ value: { mode: "read", expression: ref("x") } });
		first.subscribe(() => {
			throw new Error("SECRET listener");
		});
		const notified = vi.fn();
		second.subscribe(notified);
		first.getSnapshot();
		second.getSnapshot();
		allowed = false;
		service.invalidateAuthorization();
		expect(first.getSnapshot().values.value).toBeUndefined();
		expect(second.getSnapshot().values.value).toBeUndefined();
		expect(notified).toHaveBeenCalledTimes(1);
		expect(service.getLifecycleDiagnostics()).toEqual([{ code: "adapter" }]);
		service.dispose();
	});
});
