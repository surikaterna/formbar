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
});

describe("single captured core state", () => {
	it("derives data, form status, and direct field lifecycle from one re-entrant capture", () => {
		const core = createForm({ initialData: { value: 0 } });
		const getState = vi.fn(() => {
			const captured = core.getState();
			if (getState.mock.calls.length === 1) core.setValue("value", 1);
			return captured;
		});
		const wrapper = {
			...core,
			getState,
			isDirty: vi.fn(() => {
				throw new Error("projection must not re-read lifecycle");
			}),
			fieldDynamic: vi.fn(() => {
				throw new Error("projection must not re-read fields");
			}),
		} as unknown as FormApi<{ value: number }, unknown>;
		const port = createFormRuntime({ form: wrapper, definition: definition([field("value", ["value"])]) });
		const snapshot = port.getSnapshot();
		expect(getState).toHaveBeenCalledOnce();
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
});
