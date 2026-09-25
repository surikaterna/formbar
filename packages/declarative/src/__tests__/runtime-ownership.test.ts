import { describe, expect, it } from "vitest";
import { projectConcreteOwnership } from "../runtime-ownership.js";
import { binding, definition, field, runtime } from "./runtime-fixtures.js";

function project(children: Parameters<typeof definition>[0], data: object) {
	const validated = definition(children);
	const { form } = runtime(validated, { initialData: data });
	const capture = form.captureState();
	return { form, ownership: projectConcreteOwnership({ form, definition: validated, capture }) };
}

describe("private concrete ownership projection", () => {
	it("rejects unknown/non-field and duplicate definition IDs; zero rows have no instance", () => {
		const { ownership } = project(
			[
				{
					type: "repeater",
					id: "rows",
					scope: "row",
					binding: binding(["rows"]),
					children: [field("cell", ["x"], { binding: { ...binding(["x"]), scope: "row" } })],
				},
			],
			{ rows: [] },
		);
		expect(ownership.forField("cell")).toEqual([]);
		expect(ownership.forField("rows")).toBeUndefined();
		expect(ownership.forField("rows.0.x")).toBeUndefined();
		expect(() => definition([field("same", ["a"]), field("same", ["b"])])).toThrow();
	});

	it("retains two typed scope levels, object numeric keys and literal dotted keys", () => {
		const children = [
			{
				type: "repeater" as const,
				id: "outer",
				scope: "o",
				binding: binding(["a.b"]),
				children: [
					{
						type: "repeater" as const,
						id: "inner",
						scope: "i",
						binding: { namespace: "data", scope: "o", segments: ["0"] },
						children: [field("leaf", [], { binding: { namespace: "data", scope: "i", segments: ["deep.key"] } })],
					},
				],
			},
		];
		const { ownership } = project(children, {
			"a.b": [{ "0": [{ "deep.key": "a" }, { "deep.key": "b" }] }, { "0": [{ "deep.key": "c" }] }],
		});
		expect(
			ownership.forField("leaf")?.map((owner) => [owner.instance.scopes, owner.binding.segments, owner.eligible]),
		).toEqual([
			[
				[
					{ scope: "o", index: 0 },
					{ scope: "i", index: 0 },
				],
				["a.b", 0, "0", 0, "deep.key"],
				true,
			],
			[
				[
					{ scope: "o", index: 0 },
					{ scope: "i", index: 1 },
				],
				["a.b", 0, "0", 1, "deep.key"],
				true,
			],
			[
				[
					{ scope: "o", index: 1 },
					{ scope: "i", index: 0 },
				],
				["a.b", 1, "0", 0, "deep.key"],
				true,
			],
		]);
	});

	it("keeps both branches and protects hidden overlaps while ignoring structural container for child", () => {
		const conditional = {
			type: "conditional" as const,
			id: "choice",
			condition: { kind: "literal" as const, value: true },
			// biome-ignore lint/suspicious/noThenProperty: Serialized conditional branch, not a promise.
			then: [field("on", ["shared"])],
			else: [field("off", ["shared"])],
		};
		const { ownership } = project(
			[
				conditional,
				field("ancestor", ["obj"], { visible: { kind: "literal", value: false } }),
				field("descendant", ["obj", "part"]),
			],
			{ shared: "x", obj: { part: "y" } },
		);
		expect(ownership.forField("on")?.[0]?.visible).toBe(true);
		expect(ownership.forField("off")?.[0]?.visible).toBe(false);
		expect(ownership.forField("off")?.[0]?.protected).toBe(true);
		expect(ownership.forField("ancestor")?.[0]?.protected).toBe(true);
	});

	it("fails closed for UI, missing, wrong array slot, unbound descendants and stale capture", () => {
		const { form, ownership } = project(
			[
				field("ui", [], { binding: { namespace: "ui", segments: ["x"] } }),
				field("missing", ["missing"]),
				field("slot", ["items", "0"]),
				field("arraySlot", ["items", 0]),
				field("parent", ["obj"]),
			],
			{ items: ["x"], obj: { bound: 1, unknown: 2 } },
		);
		expect(ownership.forField("ui")?.[0]?.eligible).toBe(false);
		expect(ownership.forField("missing")?.[0]?.eligible).toBe(false);
		expect(ownership.forField("slot")?.[0]?.eligible).toBe(false);
		expect(ownership.forField("arraySlot")?.[0]?.eligible).toBe(false);
		expect(ownership.forField("parent")?.[0]?.eligible).toBe(false);
		expect(ownership.current()).toBe(true);
		form.setValue("items.0", "changed");
		expect(ownership.current()).toBe(false);
	});

	it("reprojects reordered rows; malformed repeaters fail closed without a cell certificate", () => {
		const validated = definition([
			{
				type: "repeater",
				id: "rows",
				scope: "row",
				binding: binding(["rows"]),
				children: [field("cell", [], { binding: { namespace: "data", scope: "row", segments: ["value"] } })],
			},
		]);
		const { form } = runtime(validated, { initialData: { rows: [{ value: "a" }, { value: "b" }] } });
		const capture = form.captureState();
		const first = projectConcreteOwnership({ form, definition: validated, capture });
		form.setValue("rows", [{ value: "b" }, { value: "a" }]);
		expect(first.current()).toBe(false);
		const second = projectConcreteOwnership({ form, definition: validated, capture: form.captureState() });
		expect(second.forField("cell")?.map((owner) => owner.instance.scopes[0]?.index)).toEqual([0, 1]);
		expect(second.current()).toBe(true);
		form.setValue("rows", "malformed" as never);
		const malformed = projectConcreteOwnership({ form, definition: validated, capture: form.captureState() });
		expect(malformed.diagnostics).toBe(true);
		expect(malformed.repeaters[0]?.eligible).toBe(false);
		expect(malformed.forField("cell")).toEqual([]);
	});
});
