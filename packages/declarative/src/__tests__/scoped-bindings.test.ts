import { describe, expect, it } from "vitest";
import type { FormNode } from "../index.js";
import { binding, definition, field, literal, node, op, runtime, runtimeRef } from "./runtime-fixtures.js";

function nestedDefinition() {
	const status = field("status", ["status"], { visible: runtimeRef("field", ["sku", "dirty"]) });
	const lines: FormNode = {
		type: "repeater",
		id: "lines",
		binding: binding(["lines"], "order"),
		scope: "line",
		children: [
			{ ...field("sku", ["sku"]), binding: binding(["sku"], "line") },
			{ ...status, binding: binding(["status"], "line") },
		],
	};
	return definition([
		{
			type: "repeater",
			id: "orders",
			binding: binding(["orders"]),
			scope: "order",
			children: [lines],
		},
	]);
}

describe("scoped runtime bindings", () => {
	it("resolves nested repeaters and contextual direct lifecycle without cross-item aliasing", () => {
		const { form, runtime: port } = runtime(nestedDefinition(), {
			initialData: {
				orders: [
					{
						lines: [
							{ sku: "a", status: "" },
							{ sku: "b", status: "" },
						],
					},
					{ lines: [{ sku: "c", status: "" }] },
				],
			},
		});
		expect(
			port
				.getSnapshot()
				.fields.filter((item) => item.instance.nodeId === "sku")
				.map((item) => item.binding.segments),
		).toEqual([
			["orders", 0, "lines", 0, "sku"],
			["orders", 0, "lines", 1, "sku"],
			["orders", 1, "lines", 0, "sku"],
		]);
		expect(
			port
				.getSnapshot()
				.nodes.filter((item) => item.instance.nodeId === "status")
				.map((item) => item.visible),
		).toEqual([false, false, false]);
		form.setValue("orders.0.lines.1.sku", "changed");
		expect(
			port
				.getSnapshot()
				.nodes.filter((item) => item.instance.nodeId === "status")
				.map((item) => item.visible),
		).toEqual([false, true, false]);
	});

	it("rebinds deterministic instances after array replacement and removal", () => {
		const { form, runtime: port } = runtime(nestedDefinition(), {
			initialData: { orders: [{ lines: [{ sku: "a", status: "" }] }] },
		});
		const firstKey = node(port, "sku")?.instance.instanceKey;
		form.setValue("orders", [
			{
				lines: [
					{ sku: "x", status: "" },
					{ sku: "y", status: "" },
				],
			},
		]);
		const replaced = port.getSnapshot().fields.filter((item) => item.instance.nodeId === "sku");
		expect(replaced).toHaveLength(2);
		expect(replaced[0]?.instance.instanceKey).toBe(firstKey);
		form.setValue("orders", []);
		expect(port.getSnapshot().fields.filter((item) => item.instance.nodeId === "sku")).toEqual([]);
	});

	it("exposes only direct contextual valid, validating, dirty, and touched lifecycle", () => {
		const lifecycleFields = (["valid", "validating", "dirty", "touched"] as const).map((key) => ({
			...field(`read-${key}`, [key]),
			visible:
				key === "valid"
					? runtimeRef("field", ["source", key])
					: op("eq", runtimeRef("field", ["source", key]), literal(false)),
		}));
		const formDefinition = definition([field("source", ["source"]), ...lifecycleFields]);
		const { runtime: port } = runtime(formDefinition, {
			initialData: { source: "value", valid: 1, validating: 2, dirty: 3, touched: 4 },
		});
		expect(
			port
				.getSnapshot()
				.nodes.filter((item) => item.instance.nodeId.startsWith("read-"))
				.map((item) => item.visible),
		).toEqual([true, true, true, true]);
	});
});
