import { createForm } from "@formbar/core";
import { describe, expect, it } from "vitest";
import type { FormNode, ResolvedRepeaterState } from "../index.js";
import { createActionExecutor, createFormRuntime } from "../index.js";
import { binding, definition } from "./runtime-fixtures.js";

const scoped = (scope: string, segments: readonly (string | number)[] = []) => ({
	namespace: "data" as const,
	segments,
	scope,
});

function repeater(children: readonly FormNode[], limits: { minItems?: number; maxItems?: number } = {}): FormNode {
	return {
		id: "rows",
		type: "repeater",
		binding: binding(["rows"]),
		scope: "row",
		label: "Rows",
		children,
		...limits,
	};
}

describe("repeater runtime", () => {
	it("projects concrete item scopes, bindings, labels, and malformed recovery", () => {
		const form = createForm({ initialData: { rows: [{ name: "a" }, { name: "b" }] } });
		const runtime = createFormRuntime({
			form,
			definition: definition([
				repeater([{ id: "name", type: "field", binding: scoped("row", ["name"]), widget: "text" }]),
			]),
			repeaterBaseline: [{ nodeId: "rows", minItems: 1, maxItems: 4, label: "Schema rows" }],
		});
		const projected = runtime.getSnapshot().repeaters[0] as ResolvedRepeaterState;
		expect(projected).toMatchObject({
			status: "ready",
			binding: { namespace: "data", segments: ["rows"] },
			label: "Rows",
			minItems: 1,
			maxItems: 4,
			length: 2,
		});
		expect(projected.items.map((item) => item.scopes)).toEqual([
			[{ scope: "row", index: 0 }],
			[{ scope: "row", index: 1 }],
		]);
		expect(runtime.getSnapshot().fields.map((field) => field.binding.segments)).toEqual([
			["rows", 0, "name"],
			["rows", 1, "name"],
		]);

		form.setValue("rows", "malformed" as never);
		expect(runtime.getSnapshot().repeaters[0]).toMatchObject({ status: "malformed", length: 0, items: [] });
		expect(runtime.getSnapshot().diagnostics).toContainEqual(
			expect.objectContaining({ code: "malformed-repeater", nodeId: "rows" }),
		);
		form.setValue("rows", []);
		expect(runtime.getSnapshot().repeaters[0]).toMatchObject({ status: "ready", length: 0 });
		runtime.dispose();
		form.dispose();
	});

	it("merges limits restrictively and fails conflicting limits closed", async () => {
		const remove: FormNode = {
			id: "remove",
			type: "action",
			action: "array.remove",
			target: binding(["rows"]),
		};
		const append: FormNode = {
			id: "append",
			type: "action",
			action: "array.append",
			target: binding(["rows"]),
			payload: { kind: "literal", value: "new" },
		};
		const form = createForm({ initialData: { rows: ["a", "b"] } });
		const runtime = createFormRuntime({
			form,
			definition: definition([repeater([remove], { minItems: 1, maxItems: 5 }), append]),
			repeaterBaseline: [{ nodeId: "rows", minItems: 2, maxItems: 2 }],
		});
		const executor = createActionExecutor({ form, runtime });
		const removeKey = runtime.getSnapshot().nodes.find((node) => node.instance.nodeId === "remove")
			?.instance.instanceKey;
		const appendKey = runtime.getSnapshot().nodes.find((node) => node.instance.nodeId === "append")
			?.instance.instanceKey;
		expect(await executor.execute(removeKey as string)).toEqual({ status: "failed", diagnostic: "array-min-items" });
		expect(await executor.execute(appendKey as string)).toEqual({ status: "failed", diagnostic: "array-max-items" });

		const conflict = createFormRuntime({
			form,
			definition: definition([repeater([remove], { minItems: 3 })]),
			repeaterBaseline: [{ nodeId: "rows", maxItems: 2 }],
		});
		expect(conflict.getSnapshot().repeaters[0]).toMatchObject({ limitsConflict: true });
		expect(conflict.getSnapshot().diagnostics).toContainEqual(
			expect.objectContaining({ code: "conflicting-repeater-limits" }),
		);
		executor.dispose();
		runtime.dispose();
		conflict.dispose();
		form.dispose();
	});

	it("guards relative move boundaries and resolves 500 child nodes with indexed lookup", async () => {
		const fields = Array.from(
			{ length: 5 },
			(_, index): FormNode => ({
				id: `field-${index}`,
				type: "field",
				binding: scoped("row", [`value${index}`]),
				widget: "text",
			}),
		);
		const move: FormNode = {
			id: "move-up",
			type: "action",
			action: "array.move",
			target: binding(["rows"]),
			payload: { kind: "literal", value: { offset: -1 } },
		};
		const rows = Array.from({ length: 100 }, (_, index) =>
			Object.fromEntries(fields.map((_, field) => [`value${field}`, `${index}:${field}`])),
		);
		const form = createForm({ initialData: { rows } });
		const runtime = createFormRuntime({ form, definition: definition([repeater([...fields, move])]) });
		const snapshot = runtime.getSnapshot();
		expect(snapshot.fields).toHaveLength(500);
		for (const node of snapshot.nodes) expect(runtime.getNode(node.instance.instanceKey)).toBe(node);
		const firstMove = snapshot.nodes.find((node) => node.instance.nodeId === "move-up")?.instance.instanceKey;
		const executor = createActionExecutor({ form, runtime });
		expect(await executor.execute(firstMove as string)).toEqual({ status: "failed", diagnostic: "array-boundary" });
		executor.dispose();
		runtime.dispose();
		form.dispose();
	});

	it("associates limits with actions before, after, and inside scoped repeaters", async () => {
		const append = (id: string, target = binding(["rows"])): FormNode => ({
			id,
			type: "action",
			action: "array.append",
			target,
			payload: { kind: "literal", value: "blocked" },
		});
		const before = append("before");
		const after = append("after");
		const nested = append("nested", scoped("row", ["children"]));
		const childRepeater: FormNode = {
			id: "children",
			type: "repeater",
			binding: scoped("row", ["children"]),
			scope: "child",
			maxItems: 1,
			children: [],
		};
		const form = createForm({ initialData: { rows: [{ children: ["only"] }] } });
		const runtime = createFormRuntime({
			form,
			definition: definition([before, repeater([nested, childRepeater], { maxItems: 1 }), after]),
		});
		const executor = createActionExecutor({ form, runtime });
		for (const id of ["before", "nested", "after"]) {
			const key = runtime.getSnapshot().nodes.find((candidate) => candidate.instance.nodeId === id)
				?.instance.instanceKey;
			expect(await executor.execute(key as string)).toEqual({ status: "failed", diagnostic: "array-max-items" });
		}
		expect(form.getState().data).toEqual({ rows: [{ children: ["only"] }] });
		executor.dispose();
		runtime.dispose();
		form.dispose();
	});

	it("executes all root-array operations with the empty canonical pointer", async () => {
		const actions: FormNode[] = [
			{
				id: "append",
				type: "action",
				action: "array.append",
				target: binding([]),
				payload: { kind: "literal", value: "d" },
			},
			{
				id: "insert",
				type: "action",
				action: "array.insert",
				target: binding([]),
				payload: { kind: "literal", value: { index: 1, item: "x" } },
			},
			{
				id: "remove",
				type: "action",
				action: "array.remove",
				target: binding([]),
				payload: { kind: "literal", value: 2 },
			},
			{
				id: "move",
				type: "action",
				action: "array.move",
				target: binding([]),
				payload: { kind: "literal", value: { from: 3, to: 1 } },
			},
			{
				id: "swap",
				type: "action",
				action: "array.swap",
				target: binding([]),
				payload: { kind: "literal", value: { from: 0, to: 2 } },
			},
		];
		const form = createForm({ initialData: ["a", "b", "c"] });
		const runtime = createFormRuntime({
			form,
			definition: definition([...actions, { ...repeater([]), binding: binding([]), maxItems: 8 }]),
		});
		const executor = createActionExecutor({ form, runtime });
		for (const action of actions) {
			const key = runtime.getSnapshot().nodes.find((node) => node.instance.nodeId === action.id)?.instance.instanceKey;
			expect(await executor.execute(key as string)).toEqual({ status: "completed" });
		}
		expect(form.getState().data).toEqual(["x", "d", "a", "c"]);
		executor.dispose();
		runtime.dispose();
		form.dispose();
	});

	it("applies min, max, and boundary guards to root arrays without side effects", async () => {
		const actions: FormNode[] = [
			{
				id: "append",
				type: "action",
				action: "array.append",
				target: binding([]),
				payload: { kind: "literal", value: "x" },
			},
			{
				id: "remove",
				type: "action",
				action: "array.remove",
				target: binding([]),
				payload: { kind: "literal", value: 0 },
			},
			{
				id: "move",
				type: "action",
				action: "array.move",
				target: binding([]),
				payload: { kind: "literal", value: { from: 0, to: 1 } },
			},
		];
		const form = createForm({ initialData: ["only"] });
		const runtime = createFormRuntime({
			form,
			definition: definition([...actions, { ...repeater([]), binding: binding([]), minItems: 1, maxItems: 1 }]),
		});
		const executor = createActionExecutor({ form, runtime });
		const diagnostics = ["array-max-items", "array-min-items", "array-boundary"];
		for (const [index, action] of actions.entries()) {
			const key = runtime.getSnapshot().nodes.find((node) => node.instance.nodeId === action.id)?.instance.instanceKey;
			expect(await executor.execute(key as string)).toEqual({ status: "failed", diagnostic: diagnostics[index] });
			expect(form.getState().data).toEqual(["only"]);
		}
		executor.dispose();
		runtime.dispose();
		form.dispose();
	});

	it("fails hostile arrays closed without reading item getters or mutating", async () => {
		let itemReads = 0;
		const hostile: unknown[] = [];
		Object.defineProperty(hostile, "0", {
			enumerable: true,
			configurable: true,
			get() {
				itemReads += 1;
				throw new Error("item trap");
			},
		});
		const form = createForm({ initialData: { rows: [] as unknown[] } });
		form.setValue("rows", hostile);
		const append: FormNode = {
			id: "append",
			type: "action",
			action: "array.append",
			target: binding(["rows"]),
			payload: { kind: "literal", value: "new" },
		};
		const runtime = createFormRuntime({ form, definition: definition([append, repeater([])]) });
		expect(runtime.getSnapshot().repeaters[0]).toMatchObject({ status: "malformed", length: 0 });
		expect(runtime.getSnapshot().diagnostics).toContainEqual(expect.objectContaining({ code: "malformed-repeater" }));
		const executor = createActionExecutor({ form, runtime });
		const key = runtime.getSnapshot().nodes.find((node) => node.instance.nodeId === "append")?.instance.instanceKey;
		expect(await executor.execute(key as string)).toEqual({ status: "failed", diagnostic: "action-unavailable" });
		expect(form.getState().data.rows).toBe(hostile);
		expect(itemReads).toBe(0);
		executor.dispose();
		runtime.dispose();
		form.dispose();
	});

	it("contains hostile length traps in projection and action preflight", async () => {
		const hostile = new Proxy([], {
			get(target, property, receiver) {
				if (property === "length") throw new Error("length trap");
				return Reflect.get(target, property, receiver);
			},
		});
		const form = createForm({ initialData: { rows: [] as unknown[] } });
		form.setValue("rows", hostile);
		const runtime = createFormRuntime({ form, definition: definition([repeater([])]) });
		expect(() => runtime.getSnapshot()).not.toThrow();
		expect(runtime.getSnapshot().repeaters[0]).toMatchObject({ status: "malformed", length: 0 });
		const append: FormNode = {
			id: "append",
			type: "action",
			action: "array.append",
			target: binding(["rows"]),
			payload: { kind: "literal", value: "new" },
		};
		const actionRuntime = createFormRuntime({ form, definition: definition([append]) });
		const executor = createActionExecutor({ form, runtime: actionRuntime });
		const key = actionRuntime.getSnapshot().nodes.find((node) => node.instance.nodeId === "append")
			?.instance.instanceKey;
		expect(await executor.execute(key as string)).toEqual({ status: "failed", diagnostic: "invalid-action-target" });
		expect(form.getState().data.rows).toBe(hostile);
		executor.dispose();
		actionRuntime.dispose();
		runtime.dispose();
		form.dispose();
	});
});
