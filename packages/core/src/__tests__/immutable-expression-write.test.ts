import { createExpressionService } from "@formbar/expressions";
import { describe, expect, it, vi } from "vitest";
import { createCoreExpressionNamespaces, createForm } from "../index.js";

describe("immutable descriptor-safe core writes", () => {
	it("copies data descriptors without invoking unrelated getters", () => {
		const getter = vi.fn(() => "secret");
		const form = createForm({
			initialData: { x: 1 },
			stateStrategy: { clone: (value) => value, freeze: (value) => value },
		});
		Object.defineProperty(form.getState().data, "bad", { get: getter, enumerable: true });
		const state = form.getState();
		expect(form.setValue("x", 2).ok).toBe(false);
		expect(form.getState()).toBe(state);
		expect(getter).not.toHaveBeenCalled();
		form.dispose();
	});

	it("preserves direct object branch creation and dense array append", () => {
		const form = createForm<{ nested?: { value?: number }; items: number[] }, Record<string, never>>({
			initialData: { items: [1] },
		});
		expect(form.setValue("nested.value", 2).ok).toBe(true);
		expect(form.dispatch({ type: "set-value", path: "/items/1", value: 2 }).ok).toBe(true);
		expect(form.getState().data).toEqual({ nested: { value: 2 }, items: [1, 2] });
		const state = form.getState();
		expect(form.dispatch({ type: "set-value", path: "/items/3", value: 4 }).ok).toBe(false);
		expect(form.getState()).toBe(state);
		form.dispose();
	});

	it("invalid expression targets dispatch no middleware, mutation, or notification", () => {
		const beforeAction = vi.fn();
		const form = createForm({ initialData: { items: [1] }, middleware: [{ id: "spy", beforeAction }] });
		const dispatch = vi.spyOn(form, "dispatch");
		const notification = vi.fn();
		form.subscribe(notification);
		const service = createExpressionService({ namespaces: createCoreExpressionNamespaces(form) });
		const compiled = service.compile({ kind: "ref", ref: { namespace: "data", segments: ["items", "3"] } });
		if (!compiled.ok) throw new Error("compile");
		expect(service.resolveWritable(compiled.value).ok).toBe(false);
		expect(dispatch).not.toHaveBeenCalled();
		expect(beforeAction).not.toHaveBeenCalled();
		expect(notification).not.toHaveBeenCalled();
		expect(form.getState().data.items).toEqual([1]);
		service.dispose();
		form.dispose();
	});

	it("rejects unsupported sibling descriptors before real Core dispatch", () => {
		const getter = vi.fn(() => "secret");
		const candidates: ((data: Record<string, unknown>) => void)[] = [
			(data) => Object.defineProperty(data, "bad", { get: getter, enumerable: true }),
			(data) => Object.defineProperty(data, Symbol("bad"), { value: 2, enumerable: true }),
			(data) => Object.defineProperty(data, "bad", { value: 2 }),
			(data) => Object.defineProperty(data, "__proto__", { value: 2, enumerable: true }),
		];
		for (const makeInvalid of candidates) {
			const beforeAction = vi.fn();
			const form = createForm({
				initialData: { x: 1 } as Record<string, unknown>,
				middleware: [{ id: "spy", beforeAction }],
				stateStrategy: { clone: (value) => value, freeze: (value) => value },
			});
			makeInvalid(form.getState().data);
			const dispatch = vi.spyOn(form, "dispatch");
			const notification = vi.fn();
			form.subscribe(notification);
			const service = createExpressionService({ namespaces: createCoreExpressionNamespaces(form) });
			const compiled = service.compile({ kind: "ref", ref: { namespace: "data", segments: ["x"] } });
			if (!compiled.ok) throw new Error("compile");
			expect(service.resolveWritable(compiled.value).ok).toBe(false);
			expect([dispatch, beforeAction, notification].every((spy) => spy.mock.calls.length === 0)).toBe(true);
			expect(form.getState().data.x).toBe(1);
			service.dispose();
			form.dispose();
		}
		expect(getter).not.toHaveBeenCalled();
	});
});
