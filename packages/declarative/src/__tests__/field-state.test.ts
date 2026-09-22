import type { FormPlugin, ValidationIssue } from "@formbar/core";
import { describe, expect, it } from "vitest";
import { createFormRuntime } from "../index.js";
import { definition, field, literal, runtime } from "./runtime-fixtures.js";

describe("resolved field state", () => {
	it("merges ancestor, expression, baseline, and ordered plugin policy restrictively", () => {
		const plugins: readonly FormPlugin[] = [
			{
				id: "first",
				evaluate: () => ({
					fieldPolicy: [{ path: "name", visible: true, disabled: false, readOnly: false, required: false, label: "First" }],
				}),
			},
			{
				id: "last",
				evaluate: () => ({ fieldPolicy: [{ path: "name", visible: false, disabled: true, required: true, label: "" }] }),
			},
		];
		const formDefinition = definition(
			[field("name", ["name"], { label: "Layout", visible: literal(true), required: literal(false) })],
			{ disabled: literal(true), readOnly: literal(true) },
		);
		const { form, runtime: port } = runtime(formDefinition, { initialData: { name: "Ada", tick: 0 }, plugins });
		form.setValue("tick", 1);
		const resolved = port.getSnapshot().fields[0];
		expect(resolved).toMatchObject({ visible: false, disabled: true, readOnly: true, required: true, label: "" });
	});

	it("keeps duplicate bindings as separate concrete nodes and exact-path issues", () => {
		const exact: ValidationIssue = {
			code: "exact",
			message: "Exact",
			severity: "error",
			path: { namespace: "data", segments: ["name"], format: "dot" },
			source: { origin: "function-validator", validatorId: "paths" },
		};
		const child: ValidationIssue = {
			...exact,
			code: "child",
			path: { namespace: "data", segments: ["name", "child"], format: "dot" },
		};
		const formDefinition = definition([field("primary", ["name"]), field("secondary", ["name"])]);
		const { form, runtime: port } = runtime(formDefinition, {
			initialData: { name: "Ada", tick: 0 },
			validators: [() => [exact, child]],
		});
		form.setValue("tick", 1);
		const fields = port.getSnapshot().fields;
		expect(fields.map((item) => item.instance.nodeId)).toEqual(["primary", "secondary"]);
		for (const resolved of fields) {
			expect(resolved.issues).toEqual([exact]);
			expect(resolved.valid).toBe(false);
		}
	});

	it("uses layout then schema then path labels and ORs schema requiredness", () => {
		const formDefinition = definition([
			field("layout", ["layout"], { label: "Layout" }),
			field("schema", ["schema"]),
			field("path", ["nested", "value"], { props: { required: { mode: "literal", value: true } } }),
		]);
		const { form } = runtime(formDefinition, { initialData: { layout: 1, schema: 2, nested: { value: 3 } } });
		const port = createFormRuntime({
			form,
			definition: formDefinition,
			baseline: [
				{ nodeId: "layout", label: "Schema ignored" },
				{ nodeId: "schema", label: "Schema", required: true },
			],
		});
		expect(port.getSnapshot().fields.map(({ label, required }) => [label, required])).toEqual([
			["Layout", false],
			["Schema", true],
			["/nested/value", false],
		]);
	});
});
