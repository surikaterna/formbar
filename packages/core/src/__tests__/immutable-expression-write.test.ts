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
		const form = createForm<{ nested?: { value?: number }; items: number[] }>({ initialData: { items: [1] } });
		expect(form.setValue("nested.value", 2).ok).toBe(true);
		expect(form.setValue("/items/1", 2).ok).toBe(true);
		expect(form.getState().data).toEqual({ nested: { value: 2 }, items: [1, 2] });
		const state = form.getState();
		expect(form.setValue("/items/3", 4).ok).toBe(false);
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
});
