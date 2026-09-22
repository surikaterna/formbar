import type { FormDefinition, FormNode } from "@formbar/declarative";
import { describe, expect, it } from "vitest";
import { createRuntimeFieldBaseline, createSchemaForm, jsonSchemaProvider } from "../index.js";

const provider = () => jsonSchemaProvider();

describe("schema runtime baseline adaptation", () => {
	it("keeps shared descriptor occurrences requiredness and titles occurrence-specific", () => {
		const schema = {
			type: "object",
			properties: {
				requiredName: { $ref: "#/$defs/name" },
				optionalName: { $ref: "#/$defs/name" },
			},
			required: ["requiredName"],
			$defs: { name: { type: "string", title: "Name" } },
		};
		const definition = authored([field("required", ["requiredName"]), field("optional", ["optionalName"])]);
		const prepared = createSchemaForm(schema, { provider: provider(), side: "input", definition });
		expect(prepared.baseline).toEqual([
			{ nodeId: "required", required: true, label: "Name" },
			{ nodeId: "optional", required: false, label: "Name" },
		]);
		expect(createRuntimeFieldBaseline(prepared.descriptors, prepared.definition)).toEqual(prepared.baseline);
	});

	it("returns frozen baselines for generated primitive, object, and nested-array fields", () => {
		const prepared = createSchemaForm(
			{
				type: "object",
				properties: {
					orders: {
						type: "array",
						items: {
							type: "object",
							properties: {
								lines: {
									type: "array",
									items: {
										type: "object",
										properties: { sku: { type: "string", title: "SKU" } },
										required: ["sku"],
									},
								},
							},
							required: ["lines"],
						},
					},
				},
				required: ["orders"],
			},
			{ provider: provider(), side: "input" },
		);
		expect(prepared.baseline).toHaveLength(1);
		expect(prepared.baseline[0]).toMatchObject({ required: true, label: "SKU" });
		expect(Object.isFrozen(prepared.baseline)).toBe(true);
		expect(Object.isFrozen(prepared.baseline[0])).toBe(true);

		const primitive = createSchemaForm({ type: "string", title: "Root" }, { provider: provider(), side: "input" });
		expect(primitive.baseline).toEqual([{ nodeId: primitive.definition.root.id, required: false, label: "Root" }]);
	});

	it("adapts authored nested repeater scopes and leaves unmatched fields without entries", () => {
		const schema = {
			type: "object",
			properties: {
				rows: {
					type: "array",
					items: { type: "object", properties: { value: { type: "number" } }, required: ["value"] },
				},
			},
		};
		const definition = authored([
			{
				type: "repeater",
				id: "rows",
				binding: binding(["rows"]),
				scope: "row",
				children: [{ ...field("value", ["value"]), binding: binding(["value"], "row") }],
			},
			field("unmatched", ["other"]),
		]);
		const prepared = createSchemaForm(schema, { provider: provider(), side: "input", definition });
		expect(prepared.baseline).toEqual([{ nodeId: "value", required: true }]);
	});

	it("omits conflicting schema labels and emits a deterministic compilation diagnostic", () => {
		const schema = {
			type: "object",
			properties: {
				value: {
					anyOf: [
						{ type: "string", title: "A" },
						{ type: "string", title: "B" },
					],
				},
			},
			required: ["value"],
		};
		const prepared = createSchemaForm(schema, {
			provider: provider(),
			side: "input",
			definition: authored([field("value", ["value"])]),
		});
		expect(prepared.baseline).toEqual([{ nodeId: "value", required: true }]);
		expect(prepared.diagnostics.compilation).toEqual([
			expect.objectContaining({ code: "conflicting-baseline-label", nodeId: "value" }),
		]);
	});
});

function authored(children: readonly FormNode[]): FormDefinition {
	return { version: 1, id: "authored", root: { type: "group", id: "root", children } };
}

function field(id: string, segments: readonly (string | number)[]): FormNode {
	return { type: "field", id, binding: binding(segments), widget: "text" };
}

function binding(segments: readonly (string | number)[], scope?: string) {
	return { namespace: "data", segments, ...(scope ? { scope } : {}) } as const;
}
