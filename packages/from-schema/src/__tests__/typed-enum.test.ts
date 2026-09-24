import type { FormNode } from "@formbar/declarative";
import { describe, expect, it } from "vitest";
import { InvalidFormDefinitionError, createSchemaForm, jsonSchemaProvider } from "../index.js";

const prepare = (schema: unknown) => createSchemaForm(schema, { provider: jsonSchemaProvider(), side: "input" });

function fields(node: FormNode): FormNode[] {
	return "children" in node ? node.children.flatMap(fields) : node.type === "field" ? [node] : [];
}

describe("direct JSON Schema typed enum compilation", () => {
	it.each([
		["string", ["", "CA", "US"]],
		["integer", [0, -2, 3]],
		["number", [1.5, 0, -2.25]],
		["boolean", [false, true]],
	] as const)("selects %s with exact ordered values and primitive evidence", (type, values) => {
		const result = prepare({ type: "object", properties: { choice: { type, enum: values } } });
		const field = fields(result.definition.root)[0];
		expect(field).toMatchObject({ widget: "select", binding: { segments: ["choice"] } });
		expect(result.diagnostics.compilation).not.toContainEqual(expect.objectContaining({ code: "composed-schema" }));
		const occurrence = Object.values(result.descriptors.occurrences).find(
			(item) => item.path[0] === "choice" && item.relation === "property",
		);
		const children = occurrence?.children.map((id) => result.descriptors.occurrences[id].nodeId) ?? [];
		expect(result.descriptors.evidence[children[0]]).toMatchObject({ primitive: type });
		expect(result.descriptors.evidence[children[1]]).toMatchObject({ enum: values });
	});

	it("retains explicit widget and hints on the direct intersection", () => {
		const result = prepare({
			type: "string",
			enum: ["a"],
			title: "Title",
			"x-formbar": {
				widget: "radio",
				label: "Choice",
				placeholder: "Pick",
				span: 6,
			},
		});
		expect(result.definition.root).toMatchObject({
			widget: "radio",
			label: "Choice",
			presentation: { span: 6 },
			props: { placeholder: { mode: "literal", value: "Pick" } },
		});
	});

	it("compiles direct primitive array items and expanded local refs", () => {
		const array = prepare({ type: "array", items: { type: "string", enum: ["first", "second"] } });
		expect(fields(array.definition.root)).toContainEqual(
			expect.objectContaining({
				widget: "select",
				binding: expect.objectContaining({ segments: [], scope: expect.any(String) }),
			}),
		);
		const ref = prepare({ $ref: "#/$defs/choice", $defs: { choice: { type: "boolean", enum: [true, false] } } });
		expect(ref.definition.root).toMatchObject({ widget: "select", binding: { segments: [] } });
	});

	it("preserves escaped path segments and rejects dangerous binding keys", () => {
		for (const key of ["a/b", "a~b"]) {
			const result = prepare({ type: "object", properties: { [key]: { type: "string", enum: ["safe"] } } });
			expect(fields(result.definition.root)[0]).toMatchObject({ widget: "select", binding: { segments: [key] } });
		}
		for (const key of ["__proto__", "constructor"]) {
			expect(() => prepare({ type: "object", properties: { [key]: { type: "string", enum: ["safe"] } } })).toThrow(
				InvalidFormDefinitionError,
			);
		}
	});

	it.each([
		["string", ["allowed"], ["forbidden"]],
		["integer", [1], ["1", 2]],
		["string", ["allowed"], [{ value: "forbidden", title: "Forbidden", disabled: true }]],
		["string", ["allowed", "later"], ["later", "allowed"]],
	] as const)("keeps %s enum authoritative over extension options %#", (type, values, options) => {
		const result = prepare({ type, enum: values, "x-formbar": { props: { options, placeholder: "Choose" } } });
		expect(result.definition.root).toMatchObject({
			widget: "select",
			props: {
				placeholder: { mode: "literal", value: "Choose" },
			},
		});
		expect(result.definition.root).not.toHaveProperty("props.options");
		expect(result.diagnostics.compilation).toEqual([
			expect.objectContaining({
				code: "unsupported-schema",
				message: expect.stringContaining("schema enum choices are authoritative"),
			}),
		]);
	});

	it("preserves explicit custom widget options and options-only non-enum behavior", () => {
		const custom = prepare({
			type: "string",
			enum: ["allowed"],
			"x-formbar": {
				widget: "demo.custom",
				props: { options: ["forbidden"] },
			},
		});
		expect(custom.definition.root).toMatchObject({
			widget: "demo.custom",
			props: {
				options: { mode: "literal", value: ["forbidden"] },
			},
		});
		expect(custom.diagnostics.compilation).toEqual([]);
		const optionsOnly = prepare({
			type: "string",
			"x-formbar": {
				widget: "select",
				props: { options: ["free"] },
			},
		});
		expect(optionsOnly.definition.root).toMatchObject({
			widget: "select",
			props: {
				options: { mode: "literal", value: ["free"] },
			},
		});
		expect(optionsOnly.diagnostics.compilation).toEqual([]);
	});

	it.each([
		{ type: "string", enum: [] },
		{ type: "string", enum: ["a", "a"] },
		{ type: "string", enum: ["a", null] },
		{ type: "number", enum: [1, "1"] },
		{ type: "integer", enum: [1.5] },
		{ type: "null", enum: [null] },
		{ type: "string", enum: [{ value: "a" }] },
		{ type: ["string", "null"], enum: ["a", null] },
		{ allOf: [{ type: "string" }, { enum: ["a"] }] },
		{ type: "string", allOf: [{ enum: ["a"] }] },
		{
			oneOf: [
				{ type: "string", enum: ["a"] },
				{ type: "string", enum: ["b"] },
			],
		},
	])("leaves ambiguous or unsupported schema $type / $enum unselected", (schema) => {
		const result = prepare(schema);
		expect(result.definition.root).toMatchObject({ widget: "unsupported" });
		expect(result.diagnostics.compilation).toContainEqual(expect.objectContaining({ code: "composed-schema" }));
	});

	it("keeps authored definition precedence without mutating descriptor evidence", () => {
		const schema = { type: "string", enum: ["a", "b"] };
		const generated = prepare(schema);
		const authored = createSchemaForm(schema, {
			provider: jsonSchemaProvider(),
			side: "input",
			definition: {
				version: 1,
				id: "authored",
				root: {
					id: "choice",
					type: "field",
					widget: "radio",
					binding: { namespace: "data", segments: [] },
					props: { options: { mode: "literal", value: ["b", "a"] } },
				},
			},
		});
		expect(generated.definition.root).toMatchObject({ widget: "select" });
		expect(authored.definition.root).toMatchObject({ widget: "radio", props: { options: { value: ["b", "a"] } } });
		expect(authored.descriptors.evidence).toEqual(generated.descriptors.evidence);
		expect(authored.diagnostics.compilation).toEqual([]);
	});
});
