import { describe, expect, it } from "vitest";
import { createFormRuntime, validateFormDefinition } from "../index.js";
import { binding, field, literal, runtime } from "./runtime-fixtures.js";

describe("validated hidden submission policy projection", () => {
	it("leaves legacy hidden payload submission and absent policy unchanged", async () => {
		const validated = validateFormDefinition({
			version: 1,
			id: "legacy",
			root: field("secret", ["secret"], { visible: literal(false) }),
		});
		expect(validated.ok).toBe(true);
		if (!validated.ok) return;
		const submitted: unknown[] = [];
		const { form, runtime: port } = runtime(validated.value, {
			initialData: { secret: "draft" },
			onSubmit: ({ payload }) => {
				submitted.push(payload);
			},
		});
		expect(port.getSnapshot().fields[0]?.submitWhenHidden).toBeUndefined();
		expect(Object.hasOwn(port.getSnapshot().fields[0] ?? {}, "submitWhenHidden")).toBe(false);
		await form.submit();
		expect(submitted).toEqual([{ secret: "draft" }]);
	});

	it("preserves an explicit field inclusion through hidden ancestors, both branches and Arbiter policy", async () => {
		const candidate = {
			version: 1,
			id: "visibility",
			submission: { hiddenValues: "omit-inactive" },
			root: {
				type: "group",
				id: "root",
				visible: literal(false),
				children: [
					{
						type: "conditional",
						id: "choice",
						condition: literal(true),
						// biome-ignore lint/suspicious/noThenProperty: Serialized conditional branch, not a promise.
						then: [field("on", ["on"], { submitWhenHidden: "include" })],
						else: [field("off", ["off"], { submitWhenHidden: "include" })],
					},
					field("arbiter", ["arbiter"], { submitWhenHidden: "include" }),
					field("ordinary", ["ordinary"]),
				],
			},
		};
		const validated = validateFormDefinition(candidate);
		expect(validated.ok).toBe(true);
		if (!validated.ok) return;
		expect(validated.value.root).toMatchObject(candidate.root);
		const { form } = runtime(validated.value, {
			initialData: { on: "a", off: "b", arbiter: "c", ordinary: "d" },
			plugins: [{ id: "policy", evaluate: () => ({ fieldPolicy: [{ path: "arbiter", visible: false }] }) }],
		});
		const snapshot = createFormRuntime({ form, definition: validated.value }).getSnapshot();
		expect(
			snapshot.fields.map(({ instance, visible, submitWhenHidden }) => [instance.nodeId, visible, submitWhenHidden]),
		).toEqual([
			["on", false, "include"],
			["off", false, "include"],
			["arbiter", false, "include"],
			["ordinary", false, undefined],
		]);
		expect(snapshot.nodes.filter((node) => node.type === "field")).toEqual(snapshot.fields);
		expect(Object.isFrozen(snapshot.fields[0])).toBe(true);
		expect(JSON.parse(JSON.stringify(snapshot.fields[0])).submitWhenHidden).toBe("include");
		expect((await form.submit()).ok).toBe(true);
		expect(form.getState().data).toEqual({ on: "a", off: "b", arbiter: "c", ordinary: "d" });
	});

	it("keeps per-id policy on each distinct typed nested repeater instance", () => {
		const validated = validateFormDefinition({
			version: 1,
			id: "rows",
			submission: { hiddenValues: "omit-inactive" },
			root: {
				type: "group",
				id: "root",
				children: [
					{
						type: "repeater",
						id: "outer",
						scope: "o",
						binding: binding(["groups"]),
						visible: literal(false),
						children: [
							{
								type: "repeater",
								id: "inner",
								scope: "i",
								binding: { namespace: "data", scope: "o", segments: ["rows"] },
								children: [
									{
										type: "field",
										id: "cell",
										widget: "text",
										submitWhenHidden: "include",
										binding: { namespace: "data", scope: "i", segments: ["value"] },
									},
								],
							},
						],
					},
				],
			},
		});
		expect(validated.ok).toBe(true);
		if (!validated.ok) return;
		expect(validated.value.root).toMatchObject({ type: "group", children: [{ type: "repeater" }] });
		const { runtime: port } = runtime(validated.value, {
			initialData: { groups: [{ rows: [{ value: "a" }, { value: "b" }] }, { rows: [{ value: "c" }] }] },
		});
		const fields = port.getSnapshot().fields;
		expect(fields.map(({ instance, binding: target }) => [instance.scopes, target.segments])).toEqual([
			[
				[
					{ scope: "o", index: 0 },
					{ scope: "i", index: 0 },
				],
				["groups", 0, "rows", 0, "value"],
			],
			[
				[
					{ scope: "o", index: 0 },
					{ scope: "i", index: 1 },
				],
				["groups", 0, "rows", 1, "value"],
			],
			[
				[
					{ scope: "o", index: 1 },
					{ scope: "i", index: 0 },
				],
				["groups", 1, "rows", 0, "value"],
			],
		]);
		expect(fields.every(({ visible, submitWhenHidden }) => !visible && submitWhenHidden === "include")).toBe(true);
		expect(new Set(fields.map(({ instance }) => instance.instanceKey)).size).toBe(3);
		expect(port.getSnapshot().repeaters.every((item) => !("submitWhenHidden" in item))).toBe(true);
	});
});
