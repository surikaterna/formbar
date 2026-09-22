import { createForm } from "@formbar/core";
import type { FormApi } from "@formbar/core";
import { describe, expect, it, vi } from "vitest";
import { createFormRuntime } from "../index.js";
import { definition, field, node, runtime } from "./runtime-fixtures.js";

describe("runtime snapshot adversarial values", () => {
	it("distinguishes NaN and null in both directions and notifies selected observations", () => {
		const formDefinition = definition([field("value", ["value"])]);
		const { form, runtime: port } = runtime(formDefinition, { initialData: { value: Number.NaN } });
		const selected = port.observeNode(node(port, "value")?.instance.instanceKey ?? "");
		const initial = selected.getSnapshot();
		const listener = vi.fn();
		selected.subscribe(listener);

		form.setValue("value", null as never);
		const nullable = selected.getSnapshot() as typeof initial & { readonly value?: unknown };
		expect(nullable).not.toBe(initial);
		expect(nullable?.value).toBeNull();
		expect(listener).toHaveBeenCalledTimes(1);

		form.setValue("value", Number.NaN);
		const nan = selected.getSnapshot() as typeof initial & { readonly value?: unknown };
		expect(Number.isNaN(nan?.value)).toBe(true);
		expect(listener).toHaveBeenCalledTimes(2);
	});

	it("compares bigint and nested arrays/objects without throwing and retains only equal snapshots", () => {
		const formDefinition = definition([field("value", ["value"])]);
		const { form, runtime: port } = runtime(formDefinition, {
			initialData: { value: { amount: 1n, nested: [{ code: "a" }] } },
		});
		const first = port.getSnapshot();
		expect(port.getSnapshot()).toBe(first);
		form.setValue("value", { amount: 1n, nested: [{ code: "a" }] });
		const equivalent = port.getSnapshot();
		expect(port.getSnapshot()).toBe(equivalent);
		const selected = port.observeNode(node(port, "value")?.instance.instanceKey ?? "");
		const selectedEqual = selected.getSnapshot();
		const listener = vi.fn();
		selected.subscribe(listener);
		form.setValue("value", { amount: 1n, nested: [{ code: "a" }] });
		expect(listener).not.toHaveBeenCalled();
		expect(selected.getSnapshot()).toBe(selectedEqual);
		form.setValue("value", { amount: 2n, nested: [{ code: "a" }] });
		const changed = port.getSnapshot();
		expect(changed).not.toBe(equivalent);
		expect((changed.fields[0]?.value as { amount: bigint }).amount).toBe(2n);
		expect(listener).toHaveBeenCalledOnce();
	});

	it("distinguishes an undefined own property from a missing property", () => {
		const formDefinition = definition([field("value", ["value"])]);
		const { form, runtime: port } = runtime(formDefinition, {
			initialData: { value: undefined } as { value?: undefined },
		});
		const present = port.getSnapshot();
		expect(Object.hasOwn(present.data as object, "value")).toBe(true);
		form.reset({ data: {} });
		const missing = port.getSnapshot();
		expect(missing).not.toBe(present);
		expect(Object.hasOwn(missing.data as object, "value")).toBe(false);
		form.reset({ data: { value: undefined } });
		const restored = port.getSnapshot();
		expect(restored).not.toBe(missing);
		expect(Object.hasOwn(restored.data as object, "value")).toBe(true);
	});

	it("distinguishes shared references from duplicates in both directions", () => {
		const shared = { leaf: 1 };
		const aliased = { a: shared, b: shared };
		const duplicated = { a: { leaf: 1 }, b: { leaf: 1 } };
		const { form, runtime: port } = runtime(definition([field("value", ["value"])]), {
			initialData: { value: aliased },
		});
		const wholeFirst = port.getSnapshot();
		const selected = port.observeNode(node(port, "value")?.instance.instanceKey ?? "");
		const first = selected.getSnapshot();
		const listener = vi.fn();
		selected.subscribe(listener);

		form.setValue("value", duplicated);
		const wholeSecond = port.getSnapshot();
		const second = selected.getSnapshot() as typeof first;
		expect(wholeSecond).not.toBe(wholeFirst);
		expect(second).not.toBe(first);
		expect((second?.value as typeof duplicated).a).not.toBe((second?.value as typeof duplicated).b);
		form.setValue("value", aliased);
		const wholeThird = port.getSnapshot();
		const third = selected.getSnapshot() as typeof first;
		expect(wholeThird).not.toBe(wholeSecond);
		expect(third).not.toBe(second);
		expect((third?.value as typeof aliased).a).toBe((third?.value as typeof aliased).b);
		expect(listener).toHaveBeenCalledTimes(2);
	});

	it("distinguishes self-cycles from distinct child cycles in both directions", () => {
		const self: { child?: unknown } = {};
		self.child = self;
		const child: { child?: unknown } = {};
		child.child = child;
		const nested = { child };
		const { form, runtime: port } = runtime(definition([field("value", ["value"])]), {
			initialData: { value: self },
		});
		const wholeFirst = port.getSnapshot();
		const selected = port.observeNode(node(port, "value")?.instance.instanceKey ?? "");
		const first = selected.getSnapshot();
		const listener = vi.fn();
		selected.subscribe(listener);

		form.setValue("value", nested);
		const wholeSecond = port.getSnapshot();
		const second = selected.getSnapshot() as typeof first;
		expect(wholeSecond).not.toBe(wholeFirst);
		expect(second).not.toBe(first);
		expect((second?.value as typeof nested).child).not.toBe(second?.value);
		form.setValue("value", self);
		const wholeThird = port.getSnapshot();
		const third = selected.getSnapshot() as typeof first;
		expect(wholeThird).not.toBe(wholeSecond);
		expect(third).not.toBe(second);
		expect((third?.value as typeof self).child).toBe(third?.value);
		expect(listener).toHaveBeenCalledTimes(2);
	});
});

describe("single captured core state", () => {
	it("derives data, form status, and direct field lifecycle from one re-entrant capture", () => {
		const core = createForm({ initialData: { value: 0 } });
		const captureState = vi.fn(() => {
			const captured = core.captureState();
			if (captureState.mock.calls.length === 1) core.setValue("value", 1);
			return captured;
		});
		const wrapper = {
			...core,
			captureState,
			getState: vi.fn(() => {
				throw new Error("projection must use the coherent capture");
			}),
			isDirty: vi.fn(() => {
				throw new Error("projection must not re-read lifecycle");
			}),
			fieldDynamic: vi.fn(() => {
				throw new Error("projection must not re-read fields");
			}),
		} as unknown as FormApi<{ value: number }, unknown>;
		const port = createFormRuntime({ form: wrapper, definition: definition([field("value", ["value"])]) });
		const snapshot = port.getSnapshot();
		expect(captureState).toHaveBeenCalledOnce();
		expect(snapshot.data).toEqual({ value: 0 });
		expect(snapshot.form).toMatchObject({ dirty: false, touched: false });
		expect(snapshot.fields[0]).toMatchObject({ value: 0, dirty: false, touched: false });
		expect(core.getState().data).toEqual({ value: 1 });
		expect(wrapper.isDirty).not.toHaveBeenCalled();
		expect(wrapper.fieldDynamic).not.toHaveBeenCalled();

		core.reset();
		const reset = port.getSnapshot();
		expect(reset.form).toMatchObject({ dirty: false, touched: false });
		expect(reset.fields[0]).toMatchObject({ value: 0, dirty: false, touched: false });
	});

	it("keeps authoritative dirty state when values change, restore, and reset", () => {
		const { form, runtime: port } = runtime(definition([field("name", ["name"])]), {
			initialData: { name: "Ada" },
		});
		form.setValue("name", "Grace");
		expect(port.getSnapshot()).toMatchObject({ form: { dirty: true }, fields: [{ dirty: true }] });
		form.setValue("name", "Ada");
		expect(port.getSnapshot()).toMatchObject({ form: { dirty: false }, fields: [{ dirty: false }] });
		expect(form.getState().fieldMeta.name?.dirty).toBe(true);
		expect(form.isDirty()).toBe(false);
		expect(form.field("name").isDirty()).toBe(false);

		form.reset({ data: { name: "Lin" } });
		expect(port.getSnapshot()).toMatchObject({ form: { dirty: false }, fields: [{ value: "Lin", dirty: false }] });
		form.setValue("name", "Ada");
		expect(port.getSnapshot()).toMatchObject({ form: { dirty: true }, fields: [{ dirty: true }] });
	});

	it("keeps actual UI and literal data $ui lifecycle identities separate", () => {
		const formDefinition = definition([
			field("data-value", ["$ui", "value"]),
			{ type: "field", id: "ui-value", binding: { namespace: "ui", segments: ["panel", "open"] }, widget: "text" },
		]);
		const form = createForm({
			initialData: { $ui: { value: false } },
			initialUiState: { panel: { open: false } },
		});
		const port = createFormRuntime({ form, definition: formDefinition });
		form.fieldDynamic("$ui.panel.open").markTouched();
		form.setValue("$ui.panel.open" as never, true as never);
		let snapshot = port.getSnapshot();
		expect(snapshot.form.dirty).toBe(false);
		expect(snapshot.fields).toEqual([
			expect.objectContaining({
				instance: expect.objectContaining({ nodeId: "data-value" }),
				value: false,
				touched: false,
				dirty: false,
			}),
			expect.objectContaining({
				instance: expect.objectContaining({ nodeId: "ui-value" }),
				value: true,
				touched: true,
				dirty: true,
			}),
		]);

		form.fieldDynamic("/$ui/value").markTouched();
		form.setValue("/$ui/value" as never, true as never);
		snapshot = port.getSnapshot();
		expect(Object.keys(form.getState().fieldMeta).sort()).toEqual(["$ui.panel.open", "/$ui/value"].sort());
		expect(snapshot.form.dirty).toBe(true);
		expect(snapshot.fields).toEqual([
			expect.objectContaining({
				instance: expect.objectContaining({ nodeId: "data-value" }),
				value: true,
				touched: true,
				dirty: true,
			}),
			expect.objectContaining({
				instance: expect.objectContaining({ nodeId: "ui-value" }),
				value: true,
				touched: true,
				dirty: true,
			}),
		]);

		form.setValue("$ui.panel.open" as never, false as never);
		form.setValue("/$ui/value" as never, false as never);
		expect(port.getSnapshot().fields).toEqual([
			expect.objectContaining({ touched: true, dirty: false }),
			expect.objectContaining({ touched: true, dirty: false }),
		]);
		form.reset({ data: { $ui: { value: true } }, uiState: { panel: { open: true } } });
		expect(port.getSnapshot().fields).toEqual([
			expect.objectContaining({ value: true, touched: false, dirty: false }),
			expect.objectContaining({ value: true, touched: false, dirty: false }),
		]);
	});
});
