import { describe, expect, it } from "vitest";
import { basicContactDemo } from "../demos/01-basic-contact";
import { nestedAddressDemo } from "../demos/03-nested-address";
import { installDemo } from "../runtime/kalada-demo-install";

describe("schema-attested baseline installation", () => {
	it("generates contact fields from schema without an authored definition", () => {
		const source = basicContactDemo.sources[0];
		const host = installDemo({ version: 2, schema: source.schema, definition: null, initialData: source.initialData });
		try {
			const controls = host.snapshot().controls;
			expect(controls.map((control) => control.nodeId)).toHaveLength(4);
			expect(controls.map((control) => control.rendererId)).toEqual(["text", "email", "text", "textarea"]);
			expect(controls.every((control) => Object.keys(control.writers).length > 0)).toBe(true);
		} finally {
			host.dispose();
		}
	});

	it("installs authored nested sections only for properties present in the schema", () => {
		const source = nestedAddressDemo.sources[0];
		const host = installDemo({
			version: 2,
			schema: source.schema,
			definition: source.definition,
			initialData: source.initialData,
		});
		try {
			expect(host.snapshot().controls.filter((control) => control.rendererId === "select")).toHaveLength(2);
		} finally {
			host.dispose();
		}
	});

	it("rejects unattested authored bindings before exposing a writable control", () => {
		const source = basicContactDemo.sources[0];
		expect(() =>
			installDemo({
				version: 2,
				schema: source.schema,
				initialData: {},
				definition: {
					version: 1,
					id: "unattested",
					root: { type: "field", id: "secret", widget: "text", binding: { namespace: "data", segments: ["secret"] } },
				},
			}),
		).toThrow(/UNATTESTED_PATH/);
	});
});
