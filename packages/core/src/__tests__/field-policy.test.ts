import { describe, expect, it } from "vitest";
import { createForm } from "../create-form.js";
import { normalizeDataPath } from "../field-policy.js";
import type { FieldPolicyInput } from "../field-policy.js";
import type { FormPlugin } from "../plugin-types.js";

describe("field policy paths", () => {
	it("normalizes dot, pointer, and structured integer segments without collisions", () => {
		expect(normalizeDataPath("items.01").segments).toEqual(["items", "01"]);
		expect(normalizeDataPath("/items/1").segments).toEqual(["items", 1]);
		expect(normalizeDataPath(["items", "1"]).segments).toEqual(["items", 1]);
		expect(normalizeDataPath(["profile.name"]).segments).toEqual(["profile.name"]);
		expect(normalizeDataPath("profile.name").segments).toEqual(["profile", "name"]);
	});

	it.each(["", "/", "$ui.hidden", "/$ui/hidden", "__proto__.x", ["constructor"]] as const)(
		"rejects empty, UI, and unsafe input %#",
		(input) => {
			expect(() => normalizeDataPath(input)).toThrow();
		},
	);
});

describe("plugin field policy snapshots", () => {
	it("orders producers, retains omitted snapshots, removes empty snapshots, and preserves equal references", () => {
		let first: readonly FieldPolicyInput[] | undefined = [{ path: "name", required: true }];
		let second: readonly FieldPolicyInput[] | undefined = [{ path: "/profile.name", readOnly: true }];
		const plugins: FormPlugin[] = [
			{ id: "first", evaluate: () => (first === undefined ? {} : { fieldPolicy: first }) },
			{ id: "second", evaluate: () => (second === undefined ? {} : { fieldPolicy: second }) },
		];
		const form = createForm({ initialData: { tick: 0 }, plugins });

		expect(form.getState().fieldPolicy).toEqual([]);
		form.setValue("tick", 1);
		expect(form.getState().fieldPolicy.map((item) => item.producerId)).toEqual(["first", "second"]);
		expect(form.getState().fieldPolicy[1]?.path.segments).toEqual(["profile.name"]);

		const previous = form.getState().fieldPolicy;
		first = undefined;
		second = [{ path: ["profile.name"], readOnly: true }];
		form.setValue("tick", 2);
		expect(form.getState().fieldPolicy).toBe(previous);

		second = [];
		form.setValue("tick", 3);
		expect(form.getState().fieldPolicy).toHaveLength(1);
		expect(form.getState().fieldPolicy[0]?.producerId).toBe("first");
	});

	it("rejects duplicate normalized paths transactionally", () => {
		const form = createForm({
			initialData: { tick: 0 },
			plugins: [
				{
					id: "duplicate",
					evaluate: () => ({
						fieldPolicy: [
							{ path: "items.1", disabled: true },
							{ path: "/items/1", required: true },
						],
					}),
				},
			],
		});

		const result = form.setValue("tick", 1);
		expect(result.ok).toBe(false);
		expect(form.getState().data).toEqual({ tick: 0 });
		expect(form.getState().fieldPolicy).toEqual([]);
	});

	it("changes only policy while preserving lifecycle state and clears policy before onReset", () => {
		let resetPolicyLength = -1;
		const form = createForm({
			initialData: { name: "" },
			plugins: [
				{
					id: "policy",
					evaluate: () => ({ fieldPolicy: [{ path: "name", visible: false }] }),
					onReset: () => {
						resetPolicyLength = form.getState().fieldPolicy.length;
					},
				},
			],
		});
		form.setValue("name", "Ada");
		expect(form.field("name").isTouched()).toBe(true);
		expect(form.getState().fieldPolicy).toHaveLength(1);

		form.reset();
		expect(resetPolicyLength).toBe(0);
		expect(form.getState().fieldPolicy).toEqual([]);
	});

	it("requires unique producer identities", () => {
		expect(() => createForm({ plugins: [{ id: "same" }, { id: "same" }] })).toThrow("Plugin id must be unique");
	});
});
