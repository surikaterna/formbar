import type { FormNode } from "@formbar/declarative";
import { validateFormDefinition } from "@formbar/declarative";
import { describe, expect, it } from "vitest";
import { compileDefaultFormDefinition, jsonSchemaProvider, projectSchema } from "../index.js";

function compile(schema: unknown) {
	const { descriptors } = projectSchema(schema, { provider: jsonSchemaProvider(), side: "input" });
	const result = compileDefaultFormDefinition(descriptors);
	if (!result.definition) throw new Error(JSON.stringify(result.definitionDiagnostics));
	expect(validateFormDefinition(result.definition).ok).toBe(true);
	return result;
}

function nodes(root: FormNode): FormNode[] {
	const output = [root];
	if (root.type === "group" || root.type === "section" || root.type === "repeater") {
		for (const child of root.children) output.push(...nodes(child));
	}
	return output;
}

describe("default FormDefinition compilation", () => {
	it("compiles root scalars and object properties with stable structured bindings", () => {
		const scalar = compile({ type: "string" }).definition;
		expect(scalar?.root).toMatchObject({ type: "field", binding: { namespace: "data", segments: [] }, widget: "text" });
		const first = compile({ type: "object", properties: { count: { type: "integer" } } }).definition;
		const second = compile({ type: "object", properties: { count: { type: "integer" } } }).definition;
		expect(first).toEqual(second);
		expect(nodes(first?.root as FormNode).find((node) => node.type === "field")).toMatchObject({
			binding: { namespace: "data", segments: ["count"] },
			widget: "number",
		});
	});

	it("uses lexical scopes for primitive, object, and nested arrays", () => {
		const result = compile({
			type: "object",
			properties: {
				tags: { type: "array", items: { type: "string" } },
				rows: { type: "array", items: { type: "object", properties: { name: { type: "string" } } } },
				matrix: { type: "array", items: { type: "array", items: { type: "number" } } },
			},
		}).definition;
		const all = nodes(result?.root as FormNode);
		const repeaters = all.filter((node) => node.type === "repeater");
		expect(repeaters).toHaveLength(4);
		const fields = all.filter((node) => node.type === "field");
		expect(fields).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ binding: expect.objectContaining({ segments: [], scope: expect.any(String) }) }),
				expect.objectContaining({
					binding: expect.objectContaining({ segments: ["name"], scope: expect.any(String) }),
				}),
			]),
		);
		const nested = repeaters.find((node) => node.type === "repeater" && node.binding.scope);
		expect(nested).toMatchObject({
			binding: { namespace: "data", segments: [], scope: expect.any(String) },
			scope: expect.any(String),
		});
		if (nested?.type === "repeater") expect(nested.scope).not.toBe(nested.binding.scope);
	});

	it("retains composed alternatives as evidence and diagnostics without branch selection", () => {
		const result = compile({ oneOf: [{ type: "string" }, { type: "number" }] });
		expect(result.definition?.root).toMatchObject({ type: "field", widget: "unsupported" });
		expect(result.diagnostics).toEqual([
			expect.objectContaining({ code: "composed-schema", message: expect.stringContaining("without selecting") }),
		]);
	});

	it("reads presentation only from the exact JSON Formbar extension", () => {
		const result = compile({
			type: "string",
			title: "Schema title",
			formbar: { widget: "ignored" },
			"x-formbar": { widget: "textarea", label: "Exact label", placeholder: "Write", span: 6 },
		});
		expect(result.definition?.root).toMatchObject({
			type: "field",
			widget: "textarea",
			label: "Exact label",
			presentation: { span: 6 },
			props: { placeholder: { mode: "literal", value: "Write" } },
		});
	});
});
