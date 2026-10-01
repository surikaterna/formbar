import { describe, expect, it } from "vitest";
import { compileKaladaDefaults } from "../compiler/compile-kalada-defaults.js";
import { compileDefaultKaladaV1Definition, jsonSchemaProvider, projectSchema } from "../index.js";

const project = (schema: unknown) =>
	projectSchema(schema, { provider: jsonSchemaProvider(), side: "input" }).descriptors;

describe("#408 projected initialization", () => {
	it("preserves nested object, array-template, and typed enum defaults for host-owned row initialization", () => {
		const document = project({
			type: "object",
			additionalProperties: false,
			properties: {
				profile: {
					type: "object",
					additionalProperties: false,
					properties: { name: { type: "string", default: "Ada" } },
				},
				rows: {
					type: "array",
					default: [{ code: "A" }],
					items: {
						type: "object",
						additionalProperties: false,
						properties: { code: { type: "string", enum: ["A", "B"], default: "B", "x-formbar": { widget: "radio" } } },
					},
				},
			},
		});
		expect(compileKaladaDefaults(document)).toEqual([
			{ path: ["profile", "name"], value: "Ada" },
			{ path: ["rows"], value: [{ code: "A" }] },
			{ path: ["rows", "*", "code"], value: "B" },
		]);
		expect(compileDefaultKaladaV1Definition(document).version).toBe(1);
	});

	it("rejects malformed typed defaults before host installation", () => {
		for (const schema of [
			{ type: "string", default: 4 },
			{ type: "string", enum: ["a", "b"], default: "other" },
			{ type: "array", items: { type: "string" }, default: [3] },
			{ type: "object", additionalProperties: false, properties: { name: { type: "string" } }, default: { name: 1 } },
		])
			expect(() => compileKaladaDefaults(project(schema))).toThrow(/Invalid schema default/);
	});
});
