import { describe, expect, it } from "vitest";
import { compileDefaultKaladaV1Definition, jsonSchemaProvider, projectSchema } from "../index.js";

const provider = jsonSchemaProvider();
const generate = (schema: unknown) => {
	const document = projectSchema(schema, { provider, side: "input" }).descriptors;
	return { document, root: compileDefaultKaladaV1Definition(document).root };
};

describe("direct typed enum V1 generation", () => {
	it.each([
		["string", ["", "CA", "US"]],
		["integer", [0, -2, 3]],
		["number", [1.5, 0, -2.25]],
		["boolean", [false, true]],
	] as const)("generates %s choices without coercion, preserving descriptor evidence", (type, values) => {
		const { document, root } = generate({
			type: "object",
			additionalProperties: false,
			properties: { choice: { type, enum: values } },
		});
		expect(root).toMatchObject({
			type: "group",
			children: [
				{
					type: "field",
					widget: "select",
					binding: { segments: ["choice"] },
					props: { options: { value: values.map((value) => ({ value, title: String(value) })) } },
				},
			],
		});
		const occurrence = Object.values(document.occurrences).find(
			(item) => item.path[0] === "choice" && item.relation === "property",
		);
		const children = occurrence?.children.map((id) => document.occurrences[id].nodeId) ?? [];
		expect(document.evidence[children[0]]).toMatchObject({ primitive: type });
		expect(document.evidence[children[1]]).toMatchObject({ enum: values });
	});

	it("retains direct widget, label, placeholder and layout without losing canonical options", () => {
		const { root } = generate({
			type: "string",
			enum: ["a"],
			title: "Title",
			"x-formbar": { widget: "radio", label: "Choice", placeholder: "Pick", span: 6 },
		});
		expect(root).toMatchObject({
			widget: "radio",
			label: "Choice",
			presentation: { span: 6 },
			props: { placeholder: { value: "Pick" }, options: { value: [{ value: "a", title: "a" }] } },
		});
	});

	it("preserves direct choices in item templates and local references", () => {
		const array = generate({ type: "array", items: { type: "string", enum: ["first", "second"] } });
		expect(array.root).toMatchObject({
			type: "repeater",
			children: [{ widget: "select", binding: { segments: [], scope: expect.any(String) } }],
		});
		const ref = generate({ $ref: "#/$defs/choice", $defs: { choice: { type: "boolean", enum: [true, false] } } });
		expect(ref.root).toMatchObject({
			widget: "select",
			binding: { segments: [] },
			props: { options: { value: [{ value: true }, { value: false }] } },
		});
	});

	it.each(["a/b", "a~b"])("keeps escaped key %s as an exact path segment", (key) => {
		expect(
			generate({
				type: "object",
				additionalProperties: false,
				properties: { [key]: { type: "string", enum: ["safe"] } },
			}).root,
		).toMatchObject({ children: [{ binding: { segments: [key] } }] });
	});

	it.each([
		["string", ["allowed"], ["forbidden"]],
		["integer", [1], ["1", 2]],
		["string", ["allowed", "later"], ["later", "allowed"]],
	] as const)("keeps %s schema choices authoritative over conflicting extension props", (type, values, options) => {
		const { root } = generate({ type, enum: values, "x-formbar": { props: { options, placeholder: "Choose" } } });
		expect(root).toMatchObject({
			widget: "select",
			props: {
				placeholder: { value: "Choose" },
				options: { value: values.map((value) => ({ value, title: String(value) })) },
			},
		});
		expect(JSON.stringify(root)).not.toContain('"forbidden"');
	});

	it("keeps explicit non-enum custom widget props and selectable options-only fields", () => {
		const custom = generate({ type: "string", "x-formbar": { widget: "demo.custom", props: { options: ["free"] } } });
		expect(custom.root).toMatchObject({ widget: "demo.custom", props: { options: { value: ["free"] } } });
		const optionsOnly = generate({ type: "string", "x-formbar": { widget: "select", props: { options: ["free"] } } });
		expect(optionsOnly.root).toMatchObject({ widget: "select", props: { options: { value: ["free"] } } });
	});

	it("keeps null, 0, '0' and false distinct when decorating bare enum choices", () => {
		const { root } = generate({
			enum: [null, 0, "0", false],
			"x-formbar": {
				options: [
					{ value: "0", title: "Text zero" },
					{ value: 0, title: "Number zero" },
					{ value: false, title: "False" },
					{ value: null, title: "Null" },
				],
			},
		});
		expect(root).toMatchObject({
			widget: "select",
			props: {
				options: {
					value: [
						{ value: null, title: "Null" },
						{ value: 0, title: "Number zero" },
						{ value: "0", title: "Text zero" },
						{ value: false, title: "False" },
					],
				},
			},
		});
	});

	it.each(["__proto__", "constructor"])("rejects dangerous binding key %s", (key) => {
		expect(() =>
			generate({
				type: "object",
				additionalProperties: false,
				properties: {
					[key]: { type: "string", enum: ["safe"] },
				},
			}),
		).toThrow();
	});

	it("refuses unsafe option annotations without executing a getter", () => {
		let reads = 0;
		const option = Object.defineProperty({}, "value", {
			enumerable: true,
			get() {
				reads++;
				return "a";
			},
		});
		expect(() => generate({ type: "string", enum: ["a"], "x-formbar": { options: [option] } })).toThrow();
		expect(reads).toBe(0);
	});

	it.each([
		{ type: "string", enum: [] },
		{ type: "string", enum: ["a", "a"] },
		{ type: "string", enum: ["a", null] },
		{ type: "number", enum: [1, "1"] },
		{ type: "integer", enum: [1.5] },
		{ type: "string", enum: [{ value: "a" }] },
		{ type: ["string", "null"], enum: ["a", null] },
		{ allOf: [{ type: "string" }, { enum: ["a"] }] },
	])("fails closed rather than emitting a selectable control for ambiguous schema %#", (schema) => {
		expect(() => generate(schema)).toThrow();
	});
});
