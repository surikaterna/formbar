import { createExpressionService, failure } from "@formbar/expressions";
import type { Expression, Setter } from "@formbar/expressions";
import { createKueryBackend } from "@formbar/expressions-kuery";
import { describe, expect, it, vi } from "vitest";
import { literal, namespace, op, ref } from "../../../../test/expression-fixtures.js";
import { createCoreExpressionNamespaces, createForm } from "../index.js";

function writable(service: ReturnType<typeof createExpressionService>, expression: Expression): Setter {
	const compiled = service.compile(expression);
	if (!compiled.ok) throw new Error("compile");
	const result = service.resolveWritable(compiled.value);
	if (!result.ok) throw new Error("resolve");
	return result.value;
}

describe("core expression namespace adapter", () => {
	it("resolves nested item scopes against real state and never retargets a disposed binding", () => {
		const form = createForm({ initialData: { orders: [{ items: [{ price: 2 }, { price: 3 }] }] } });
		const service = createExpressionService({
			backend: createKueryBackend(),
			namespaces: createCoreExpressionNamespaces(form),
			scopes: {
				order: { namespace: "data", segments: ["orders", 0] },
				item: { namespace: "data", scope: "order", segments: ["items", 1] },
			},
		});
		const binding = service.resolveProps({
			value: {
				mode: "write",
				expression: { kind: "ref", ref: { namespace: "data", scope: "item", segments: ["price"] } },
			},
		});
		binding.subscribe(() => {});
		expect(binding.getSnapshot().values.value).toBe(3);
		expect(binding.getSnapshot().setters.value(5).ok).toBe(true);
		expect(form.getState().data.orders[0].items.map((item) => item.price)).toEqual([2, 5]);
		const retained = binding.getSnapshot().setters.value;
		binding.dispose();
		expect(retained(9)).toEqual(failure("stale"));
		service.dispose();
		form.dispose();
	});
	it("writes through core mutation/veto results and reads nested data/UI", () => {
		const form = createForm({
			initialData: { x: 1 },
			initialUiState: { field: { disabled: false } },
			middleware: [
				{
					id: "veto",
					beforeAction: ({ action }) =>
						action.value === 99 ? { action: "veto", reason: "locked" } : { action: "continue" },
				},
			],
		});
		const service = createExpressionService({
			backend: createKueryBackend(),
			namespaces: createCoreExpressionNamespaces(form),
		});
		expect(writable(service, ref("x"))(3)).toEqual({ ok: true });
		const denied = writable(service, ref("x"))(99);
		expect(denied).toEqual(form.dispatch({ type: "set-value", path: "/x", value: 99 }));
		expect(denied.ok).toBe(false);
		expect(form.getState().data.x).toBe(3);
		const uiRef = { kind: "ref", ref: { namespace: "ui", segments: ["field", "disabled"] } } as const;
		expect(writable(service, uiRef)(true).ok).toBe(true);
		expect(form.getState().uiState.field.disabled).toBe(true);
		const compiled = service.compile(uiRef);
		if (compiled.ok) expect(service.evaluate(compiled.value)).toEqual({ ok: true, value: true });
	});
	it("tracks dependency edits, parent replacement and reset but not unrelated changes", () => {
		const form = createForm({ initialData: { item: { quantity: 2 }, other: 0 } });
		const service = createExpressionService({
			backend: createKueryBackend(),
			namespaces: createCoreExpressionNamespaces(form),
			scopes: { item: { namespace: "data", segments: ["item"] } },
		});
		const expression = { kind: "ref", ref: { namespace: "data", segments: ["quantity"], scope: "item" } } as const;
		const compiled = service.compile(op("multiply", expression, literal(5)));
		if (!compiled.ok) throw new Error("compile");
		const observed = service.observe(compiled.value);
		const listener = vi.fn();
		const first = observed.getSnapshot();
		const stop = observed.subscribe(listener);
		form.setValue("other", 1);
		expect(observed.getSnapshot()).toBe(first);
		expect(listener).not.toHaveBeenCalled();
		const stale = writable(service, expression);
		form.setValue("item", { quantity: 3 });
		expect(stale(10)).toEqual(failure("stale"));
		expect(observed.getSnapshot()).toEqual({ ok: true, value: 15 });
		const resetSetter = writable(service, expression);
		form.reset();
		expect(resetSetter(10)).toEqual(failure("stale"));
		expect(observed.getSnapshot()).toEqual({ ok: true, value: 10 });
		expect(listener).toHaveBeenCalledTimes(2);
		stop();
		service.dispose();
		form.dispose();
	});
	it("uses safe escaped paths without widening core namespaces", () => {
		const form = createForm({
			initialData: { "a.b": { "a/b~c": 1 }, list: [2], $ui: { hidden: "data" } },
			initialUiState: { "a.b": false },
		});
		const service = createExpressionService({
			backend: createKueryBackend(),
			namespaces: createCoreExpressionNamespaces(form),
		});
		const expr = (namespace: string, segments: readonly (string | number)[]): Expression => ({
			kind: "ref",
			ref: { namespace, segments },
		});
		expect(writable(service, expr("data", ["a.b", "a/b~c"]))(3).ok).toBe(true);
		expect(form.getState().data["a.b"]["a/b~c"]).toBe(3);
		expect(writable(service, expr("data", ["list", 0]))(4).ok).toBe(true);
		expect(form.getState().data.list).toEqual([4]);
		expect(writable(service, expr("ui", ["a.b"]))(true).ok).toBe(true);
		expect(form.getState().uiState["a.b"]).toBe(true);
		expect(writable(service, expr("data", ["$ui", "hidden"]))("bad")).toEqual(failure("read-only"));
		expect(writable(service, expr("data", []))({})).toEqual(failure("read-only"));
		expect(service.compile(expr("data", ["__proto__", "polluted"])).ok).toBe(false);
		expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
	});
	it("invalidates mounted values and retained setters when the actual form is disposed", () => {
		const form = createForm({ initialData: { x: "secret" } });
		const service = createExpressionService({
			backend: createKueryBackend(),
			namespaces: createCoreExpressionNamespaces(form),
		});
		const binding = service.resolveProps({ value: { mode: "write", expression: ref("x") } });
		const listener = vi.fn();
		binding.subscribe(listener);
		const setter = binding.getSnapshot().setters.value;
		form.dispose();
		expect(form.isDisposed()).toBe(true);
		expect(binding.getSnapshot().values.value).toBeUndefined();
		expect(setter("bad")).toEqual(failure("disposed"));
		expect(listener).toHaveBeenCalledTimes(1);
		service.dispose();
	});
	it("supports external namespace invalidation and readonly capabilities", () => {
		const form = createForm({ initialData: { x: 1 } });
		const external = namespace({ rate: 2 });
		const service = createExpressionService({
			backend: createKueryBackend(),
			namespaces: { ...createCoreExpressionNamespaces(form), pricing: { ...external.provider, write: undefined } },
		});
		const binding = service.resolveProps({ custom: { mode: "read", expression: ref("rate", "pricing") } });
		binding.subscribe(() => {});
		expect(binding.getSnapshot().values.custom).toBe(2);
		external.replace({ rate: 3 });
		expect(binding.getSnapshot().values.custom).toBe(3);
		expect(binding.getSnapshot().setters.custom).toBeUndefined();
		service.dispose();
		expect(external.listeners.size).toBe(0);
	});
});
