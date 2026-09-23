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
});
