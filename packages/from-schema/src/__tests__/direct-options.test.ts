import { describe, expect, it } from "vitest";
import { compileDefaultKaladaV1Definition, jsonSchemaProvider, projectSchema } from "../index.js";
import { hostSchema, validationHost } from "./kalada-validation-host-408.js";

const generate = (schema: unknown) => {
	const document = projectSchema(schema, { provider: jsonSchemaProvider(), side: "input" }).descriptors;
	return { document, root: compileDefaultKaladaV1Definition(document).root };
};

describe("direct JSON Schema options in generated Kalada V1 fields", () => {
	it.each([
		{
			schema: { type: "string", enum: ["lead", "qa"], "x-formbar": { options: [{ value: "lead", title: "Lead" }] } },
			choices: [
				{ value: "lead", title: "Lead" },
				{ value: "qa", title: "qa" },
			],
		},
		{
			schema: {
				type: "integer",
				enum: [0, 1],
				"x-formbar": {
					options: [
						{ value: 1, title: "One", disabled: true },
						{ value: 0, title: "Zero" },
					],
				},
			},
			choices: [
				{ value: 0, title: "Zero" },
				{ value: 1, title: "One", disabled: true },
			],
		},
		{
			schema: {
				type: "boolean",
				enum: [false, true],
				"x-formbar": { widget: "radio", options: [{ value: true, title: "Yes" }] },
			},
			choices: [
				{ value: false, title: "false" },
				{ value: true, title: "Yes" },
			],
		},
	])("decorates typed choices in schema order without changing the binding", ({ schema, choices }) => {
		const { document, root } = generate(schema);
		expect(root).toMatchObject({
			type: "field",
			binding: { namespace: "data", segments: [] },
			props: { options: { mode: "literal", value: choices } },
		});
		expect(document.source.availability).toBe("complete");
	});

	it("does not conflate null, numeric zero, text zero and false in bare enum annotations", () => {
		const { root } = generate({
			enum: [null, 0, "0", false],
			"x-formbar": {
				options: [
					{ value: "0", title: "Text" },
					{ value: 0, title: "Number" },
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
						{ value: 0, title: "Number" },
						{ value: "0", title: "Text" },
						{ value: false, title: "False" },
					],
				},
			},
		});
	});

	it("retains canonical choices in direct item templates and expanded local refs", () => {
		const item = { type: "integer", enum: [2, 1], "x-formbar": { options: [{ value: 1, title: "One" }] } };
		expect(generate({ type: "array", items: item }).root).toMatchObject({
			type: "repeater",
			children: [
				{
					widget: "select",
					props: {
						options: {
							value: [
								{ value: 2, title: "2" },
								{ value: 1, title: "One" },
							],
						},
					},
				},
			],
		});
		expect(generate({ $ref: "#/$defs/item", $defs: { item } }).root).toMatchObject({
			widget: "select",
			props: {
				options: {
					value: [
						{ value: 2, title: "2" },
						{ value: 1, title: "One" },
					],
				},
			},
		});
	});

	it("installs an enum field in the real host, writes a choice and submits projected data", async () => {
		const schema = {
			...hostSchema,
			properties: {
				...hostSchema.properties,
				profile: {
					...hostSchema.properties.profile,
					properties: {
						name: {
							type: "string",
							enum: ["original", "changed"],
							"x-formbar": { options: [{ value: "changed", title: "Changed", disabled: true }] },
						},
					},
				},
			},
		};
		const f = validationHost(schema);
		const field = (f.definition.root as { children: { children: unknown[] }[] }).children[0].children[0];
		expect(field).toMatchObject({
			widget: "select",
			props: {
				options: {
					value: [
						{ value: "original", title: "original" },
						{ value: "changed", title: "Changed", disabled: true },
					],
				},
			},
		});
		const control = f.host.snapshot().controls.find((item) => item.nodeId === f.nameId);
		expect(control?.value).toBe("original");
		expect(control?.writers.value?.("changed")).toEqual({ status: "applied" });
		expect(f.host.snapshot().data).toMatchObject({ profile: { name: "changed" } });
		expect(await f.host.submit()).toEqual({ status: "submitted" });
		expect(f.installed.instances.values().next().value?.outgoing).toMatchObject({ profile: { name: "changed" } });
		f.host.dispose();
	});

	it("fails closed for malformed, ambiguous or unsafe options rather than inventing a fallback", () => {
		for (const options of [[{ value: "a", disabled: "yes" }], [{ value: "a", extra: 1 }], [{ value: {} }]]) {
			expect(() => generate({ type: "string", enum: ["a"], "x-formbar": { options } })).toThrow();
		}
		let reads = 0;
		const accessor = Object.defineProperty({}, "value", {
			enumerable: true,
			get() {
				reads++;
				return "a";
			},
		});
		expect(() => generate({ type: "string", enum: ["a"], "x-formbar": { options: [accessor] } })).toThrow();
		expect(reads).toBe(0);
		expect(() => generate({ type: "number", enum: [0, "0"] })).toThrow();
		expect(() => generate({ anyOf: [{ type: "string", enum: ["a"] }] })).toThrow();
	});
});
