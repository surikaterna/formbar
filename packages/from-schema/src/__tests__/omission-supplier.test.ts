import { createForm } from "@formbar/core";
import { projectBoundOmission } from "@formbar/declarative/internal/omission-supplier";
import { describe, expect, it } from "vitest";
import { createSchemaForm, jsonSchemaProvider } from "../index.js";

describe("#327 prepared form-bound supplier", () => {
	it("attaches to authored eager and deferred forms, not a different form or generated include default", () => {
		const prepared = createSchemaForm(
			{},
			{
				provider: jsonSchemaProvider(),
				side: "input",
				definition: {
					version: 1,
					id: "authored",
					submission: { hiddenValues: "omit-inactive" },
					root: {
						type: "group",
						id: "root",
						children: [
							{
								type: "field",
								id: "hidden",
								widget: "text",
								binding: { namespace: "data", segments: ["hidden"] },
								visible: { kind: "literal", value: false },
							},
						],
					},
				},
			},
		);
		for (const form of [
			prepared.createForm({ initialData: { hidden: "draft" } }),
			prepared.createDeferredForm({ initialData: { hidden: "draft" } }).form,
		]) {
			const capture = form.captureState();
			const result = projectBoundOmission(form, capture);
			expect(result?.data).toEqual({});
			expect(result?.checkFinal({})).toBe(true);
			expect(form.getState().data).toEqual({ hidden: "draft" });
			form.dispose();
		}
		const generated = createSchemaForm(
			{ type: "object", properties: { hidden: { type: "string" } } },
			{
				provider: jsonSchemaProvider(),
				side: "input",
				generation: {},
			},
		);
		const form = generated.createForm({ initialData: { hidden: "draft" } });
		expect(projectBoundOmission(form, form.captureState())?.data).toEqual({ hidden: "draft" });
		form.dispose();
	});

	it("leaves required and conditional schema validation to a later FINAL candidate, not this projection", () => {
		const prepared = createSchemaForm(
			{
				type: "object",
				properties: { flag: { type: "boolean" }, hidden: { type: "string" } },
				if: { properties: { flag: { const: true } } },
				then: { required: ["hidden"] },
			},
			{
				provider: jsonSchemaProvider(),
				side: "input",
				definition: {
					version: 1,
					id: "required",
					submission: { hiddenValues: "omit-inactive" },
					root: {
						type: "group",
						id: "root",
						children: [
							{
								type: "field",
								id: "hidden",
								widget: "text",
								binding: { namespace: "data", segments: ["hidden"] },
								visible: { kind: "literal", value: false },
							},
						],
					},
				},
			},
		);
		const draft = prepared.createForm({ initialData: { flag: true, hidden: "draft" } });
		expect(draft.validate()).toEqual([]);
		const projection = projectBoundOmission(draft, draft.captureState());
		expect(projection?.data).toEqual({ flag: true });
		const final = createForm({ initialData: projection?.data, validators: prepared.validators });
		expect(final.validate().map((issue) => issue.path.segments)).toContainEqual(["hidden"]);
		expect(draft.getState().data).toEqual({ flag: true, hidden: "draft" });
		final.dispose();
		draft.dispose();
	});
});
