import { describe, expect, it } from "vitest";
import { hostSchema, validationHost } from "./kalada-validation-host-408.js";

describe("#376/#408 host-scoped row validation", () => {
	it("resolves nested rows by host identity, not rendered position", async () => {
		const f = validationHost();
		const original = f.host.snapshot().controls.find((control) => control.nodeId === f.quantityId);
		expect(original?.value).toBe("child");
		expect(original?.writers.value?.("edited")).toEqual({ status: "applied" });
		const state = f.installed.instances.values().next().value;
		if (!state) throw Error("missing host instance");
		state.rows.reverse();
		f.installed.bump(state);
		const moved = f.host.snapshot().controls.find((control) => control.nodeId === f.quantityId);
		expect(moved?.key).toBe(original?.key);
		expect(original?.writers.value?.("stale")).not.toEqual({ status: "applied" });
		expect(await f.host.submit()).toEqual({ status: "submitted" });
		expect(state.outgoing).toEqual(f.host.snapshot().data);
		f.host.dispose();
	});

	it("preserves nested issue path and schema provenance when a row is invalid", async () => {
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
									properties: { quantity: { type: "string", minLength: 10 } },
								},
							},
						},
					},
				},
			},
		};
		const f = validationHost(schema);
		const installed = f.installed.instances.values().next().value;
		const validators = installed?.validators;
		expect(validators).toBeDefined();
		const issues = (
			await Promise.all(
				(validators ?? []).map((validate) => validate(f.host.snapshot().data, new AbortController().signal)),
			)
		).flat();
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ source: "schema", path: ["rows", 0, "nested", 0, "quantity"] }),
			]),
		);
		expect(await f.host.submit()).toEqual({ status: "denied" });
		expect(installed?.outgoing).toBeUndefined();
		f.host.dispose();
	});
});
