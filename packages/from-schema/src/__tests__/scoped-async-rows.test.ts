import { expect, test } from "vitest";
import { hostSchema, validationHost } from "./kalada-validation-host-408.js";

test("nested row writer follows host token after reorder, not its old index", async () => {
	const fixture = validationHost();
	try {
		const state = fixture.installed.instances.values().next().value;
		if (!state) throw Error("missing installed instance");
		const first = fixture.host.snapshot().controls.find((control) => control.nodeId === fixture.quantityId);
		expect(first?.writers.value?.("first edit")).toEqual({ status: "applied" });
		state.rows.reverse();
		fixture.installed.bump(state);
		const moved = fixture.host.snapshot().controls.find((control) => control.nodeId === fixture.quantityId);
		expect(moved?.key).toBe(first?.key);
		expect(first?.writers.value?.("stale edit")).not.toEqual({ status: "applied" });
		expect(moved?.writers.value?.("new edit")).toEqual({ status: "applied" });
		expect(state.rows[1]?.nested[0]?.quantity).toBe("new edit");
		expect(await fixture.host.submit()).toEqual({ status: "submitted" });
		expect(state.outgoing).toEqual(fixture.host.snapshot().data);
	} finally {
		fixture.host.dispose();
	}
});

test("row schema issues keep numeric indices and schema provenance independently", async () => {
	const schema = {
		...hostSchema,
		properties: {
			...hostSchema.properties,
			rows: {
				...hostSchema.properties.rows,
				items: {
					...hostSchema.properties.rows.items,
					properties: {
						nested: {
							...hostSchema.properties.rows.items.properties.nested,
							items: {
								type: "object",
								additionalProperties: false,
								properties: { quantity: { type: "string", minLength: 20 } },
							},
						},
					},
				},
			},
		},
	};
	const fixture = validationHost(schema);
	try {
		const state = fixture.installed.instances.values().next().value;
		if (!state?.validators) throw Error("missing installed validators");
		state.rows[1]?.nested.push({ token: {}, revision: {}, quantity: "short", nested: [], readOnly: false });
		fixture.installed.bump(state);
		const issues = (
			await Promise.all(
				state.validators.map((validator) => validator(fixture.host.snapshot().data, new AbortController().signal)),
			)
		).flat();
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path: ["rows", 0, "nested", 0, "quantity"], source: "schema" }),
				expect.objectContaining({ path: ["rows", 1, "nested", 0, "quantity"], source: "schema" }),
			]),
		);
		expect(await fixture.host.submit()).toEqual({ status: "denied" });
		expect(state.outgoing).toBeUndefined();
	} finally {
		fixture.host.dispose();
	}
});
