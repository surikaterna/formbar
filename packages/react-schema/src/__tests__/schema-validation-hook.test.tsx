import type { FormApi } from "@formbar/core";
import { jsonSchemaProvider } from "@formbar/from-schema";
import type { SchemaFormDiagnostics } from "@formbar/from-schema";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { useSchemaForm } from "../use-schema-form.js";

const provider = jsonSchemaProvider();

function mountSchema(schema: unknown, onSubmit: ReturnType<typeof vi.fn>) {
	let form: FormApi<Record<string, unknown>, Record<string, unknown>> | undefined;
	let diagnostics: SchemaFormDiagnostics | undefined;
	function Hook() {
		const prepared = useSchemaForm<Record<string, unknown>, Record<string, unknown>>(schema, {
			provider,
			side: "input",
			initialData: {},
			onSubmit,
		});
		form = prepared.form;
		diagnostics = prepared.diagnostics;
		return null;
	}
	renderToString(<Hook />);
	if (!form || !diagnostics) throw Error("Expected the real hook to prepare a form");
	return { form, diagnostics };
}

describe("plain JSON Schema hook submission", () => {
	it("attaches prepared scoped sync before the deferred form's first validation", () => {
		let form: FormApi<{ name: string }, object> | undefined;
		function Hook() {
			form = useSchemaForm<{ name: string }, object>(
				{ type: "object", properties: { name: { type: "string" } } },
				{
					provider,
					side: "input",
					initialData: { name: "Ada" },
					definition: {
						version: 1,
						id: "authored",
						root: {
							type: "field",
							id: "name-field",
							widget: "text",
							binding: { namespace: "data", segments: ["name"] },
						},
					},
					fieldValidators: [
						{ fieldId: "name-field", validate: () => [{ code: "scoped", message: "bad", severity: "error" }] },
					],
				},
			).form;
			return null;
		}
		renderToString(<Hook />);
		expect(form?.validate().map((issue) => issue.code)).toEqual(["scoped"]);
		form?.dispose();
	});
	it.each([
		["inherited required root", Object.create({ type: "object", required: ["name"] })],
		["Date root", new Date("2026-01-01")],
		["inherited nested constraint", { type: "object", properties: { name: Object.create({ type: "string" }) } }],
	])("fails closed for %s before onSubmit", async (_name, schema) => {
		const onSubmit = vi.fn(async () => ({ ok: true as const, submitId: "unexpected" }));
		const { form, diagnostics } = mountSchema(schema, onSubmit);
		expect(diagnostics.validation).toMatchObject([{ code: "non-plain-schema", severity: "error" }]);
		expect(form.validate()).toMatchObject([{ code: "json-schema.adapter-failure", path: { segments: [] } }]);
		expect(await form.submit()).toMatchObject({ ok: false, reason: "validation-failed" });
		expect(onSubmit).not.toHaveBeenCalled();
		form.dispose();
	});

	it("submits ordinary JSON data through the same real hook", async () => {
		const onSubmit = vi.fn(async () => ({ ok: true as const, submitId: "saved" }));
		const { form, diagnostics } = mountSchema({ type: "object", required: ["name"] }, onSubmit);
		expect(diagnostics.validation).toEqual([]);
		expect(form.validate().map((issue) => issue.code)).toEqual(["json-schema.required"]);
		form.setValue("name", "Ada");
		expect(await form.submit()).toMatchObject({ ok: true });
		expect(onSubmit).toHaveBeenCalledTimes(1);
		form.dispose();
	});
});
