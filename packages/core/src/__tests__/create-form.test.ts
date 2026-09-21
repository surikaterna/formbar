import { describe, expect, it, vi } from "vitest";
import { createForm } from "../create-form.js";
import { mergeFieldConfig } from "../field-api.js";

describe("createForm", () => {
	it("returns FormApi with all methods", () => {
		const form = createForm();
		expect(typeof form.getState).toBe("function");
		expect(typeof form.dispatch).toBe("function");
		expect(typeof form.setValue).toBe("function");
		expect(typeof form.validate).toBe("function");
		expect(typeof form.submit).toBe("function");
		expect(typeof form.field).toBe("function");
		expect(typeof form.subscribe).toBe("function");
		expect(typeof form.dispose).toBe("function");
	});

	it("getState returns initial state with defaults", () => {
		const form = createForm();
		const state = form.getState();
		expect(state.data).toEqual({});
		expect(state.uiState).toEqual({});
		expect(state.meta.stage).toBeUndefined();
		expect(state.issues).toEqual([]);
		expect(state.meta.validation).toEqual({ validating: false });
	});

	it("getState uses provided initialData and initialUiState", () => {
		const form = createForm({
			initialData: { name: "Alice" },
			initialUiState: { focused: true },
		});
		const state = form.getState();
		expect(state.data).toEqual({ name: "Alice" });
		expect(state.uiState).toEqual({ focused: true });
	});

	it("setValue updates data at path", () => {
		const form = createForm({ initialData: { name: "" } });
		const result = form.setValue("name", "Bob");
		expect(result.ok).toBe(true);
		expect((form.getState().data as Record<string, unknown>).name).toBe("Bob");
	});

	it("setValue updates nested data at path", () => {
		const form = createForm({ initialData: { address: { city: "" } } });
		form.setValue("address.city", "NYC");
		expect(((form.getState().data as Record<string, unknown>).address as Record<string, unknown>).city).toBe("NYC");
	});

	it("subscribe fires on setValue", () => {
		const form = createForm({ initialData: { x: 0 } });
		const listener = vi.fn();
		form.subscribe(listener);
		form.setValue("x", 42);
		expect(listener).toHaveBeenCalledTimes(1);
		expect((listener.mock.calls[0][0].data as Record<string, unknown>).x).toBe(42);
	});

	it("dispose stops listener notifications", () => {
		const form = createForm({ initialData: { x: 0 } });
		const listener = vi.fn();
		form.subscribe(listener);
		form.dispose();
		form.setValue("x", 1);
		expect(listener).not.toHaveBeenCalled();
	});

	it("field(path) returns FieldApi with correct path", () => {
		const form = createForm({ initialData: { name: "test" } });
		const f = form.field("name");
		expect(f.path.namespace).toBe("data");
		expect(f.path.segments).toEqual(["name"]);
	});

	it("field(path).get() returns value at path", () => {
		const form = createForm({ initialData: { name: "Alice" } });
		const f = form.field("name");
		expect(f.get()).toBe("Alice");
	});

	it("field(path).set(value) updates state", () => {
		const form = createForm({ initialData: { name: "" } });
		const f = form.field("name");
		const result = f.set("Bob");
		expect(result.ok).toBe(true);
		expect(f.get()).toBe("Bob");
	});

	it("field(path).issues() returns empty initially", () => {
		const form = createForm({ initialData: { name: "" } });
		const f = form.field("name");
		expect(f.issues()).toEqual([]);
	});

	it("field(path) with same path returns cached instance", () => {
		const form = createForm({ initialData: { name: "" } });
		const f1 = form.field("name");
		const f2 = form.field("name");
		expect(f1).toBe(f2);
	});

	it("field(path) with different config returns distinct instance", () => {
		const form = createForm({ initialData: { name: "" } });
		const f1 = form.field("name");
		const f2 = form.field("name", { label: "Name" });
		expect(f1).not.toBe(f2);
	});

	it("submit without onSubmit still works (no-op submit)", async () => {
		const form = createForm();
		const result = await form.submit();
		expect(result.ok).toBe(true);
		expect(result.submitId).toBeDefined();
	});

	it("validate returns empty when no validators", () => {
		const form = createForm();
		const issues = form.validate();
		expect(issues).toEqual([]);
	});

	it("default initial state has no stage", () => {
		const form = createForm();
		expect(form.getState().meta.stage).toBeUndefined();
	});

	it("dispatch with set-value action works", () => {
		const form = createForm({ initialData: { x: 0 } });
		const result = form.dispatch({ type: "set-value", path: "x", value: 99 });
		expect(result.ok).toBe(true);
		expect((form.getState().data as Record<string, unknown>).x).toBe(99);
	});

	it("dispatch with unknown action type succeeds as no-op", () => {
		const form = createForm();
		const result = form.dispatch({ type: "unknown-action" });
		expect(result.ok).toBe(true);
	});

	it("field ui selector works", () => {
		const form = createForm({ initialUiState: { theme: "dark" } });
		const f = form.field("name");
		const theme = f.ui((ui) => (ui as Record<string, unknown>).theme);
		expect(theme).toBe("dark");
	});

	it("submit with onSubmit calls handler", async () => {
		const onSubmit = vi.fn().mockResolvedValue({ ok: true, submitId: "test-id" });
		const form = createForm({ onSubmit });
		const result = await form.submit();
		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(result.ok).toBe(true);
	});

	it("submit updates meta.submission status", async () => {
		const form = createForm();
		await form.submit();
		const state = form.getState();
		expect(state.meta.submission?.status).toBe("succeeded");
	});
});

describe("mergeFieldConfig — 3-tier precedence", () => {
	it("returns undefined when both are undefined", () => {
		expect(mergeFieldConfig(undefined, undefined)).toBeUndefined();
	});

	it("returns formDefaults when no field overrides", () => {
		const defaults = { label: "Default", disabled: true };
		expect(mergeFieldConfig(defaults, undefined)).toEqual(defaults);
	});

	it("returns field overrides when no form defaults", () => {
		const overrides = { label: "Override", required: true };
		expect(mergeFieldConfig(undefined, overrides)).toEqual(overrides);
	});

	it("field overrides take precedence over form defaults", () => {
		const defaults = { label: "Default", disabled: true, readOnly: false };
		const overrides = { label: "Override", required: true };
		const merged = mergeFieldConfig(defaults, overrides);
		expect(merged).toEqual({ label: "Override", disabled: true, readOnly: false, required: true });
	});

	it("does not let undefined field values override form defaults", () => {
		const defaults = { label: "Default", disabled: true };
		const overrides = { label: undefined, required: true } as unknown as typeof defaults;
		const merged = mergeFieldConfig(defaults, overrides);
		expect(merged?.label).toBe("Default");
		expect(merged?.disabled).toBe(true);
	});
});
