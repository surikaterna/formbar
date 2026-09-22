import { describe, expect, it } from "vitest";
import { baselineFixtures } from "../demos";
import { createJsonSchemaValidator, createJsonSchemaValidators } from "../validation/json-schema-validator";

function validate(schema: Readonly<Record<string, unknown>>, data: Record<string, unknown>) {
	return createJsonSchemaValidator(schema)({ data, uiState: {} });
}

describe("Draft 2020-12 JSON Schema adapter", () => {
	it("compiles every shared fixture source, including multi-source and Arbiter demos", () => {
		const sources = baselineFixtures.flatMap((fixture) => fixture.sources);
		expect(sources).toHaveLength(14);
		for (const source of sources) {
			expect(() => createJsonSchemaValidator(source.schema), source.key).not.toThrow();
		}
	});

	it("caches compilation by immutable schema identity without crossing schemas", () => {
		const first = { type: "object", required: ["first"] } as const;
		const second = { type: "object", required: ["second"] } as const;
		expect(createJsonSchemaValidator(first)).toBe(createJsonSchemaValidator(first));
		expect(createJsonSchemaValidator(first)).not.toBe(createJsonSchemaValidator(second));
		expect(createJsonSchemaValidators(first)).toBe(createJsonSchemaValidators(first));
		expect(createJsonSchemaValidators(first)).not.toBe(createJsonSchemaValidators(second));
		expect(validate(first, {})[0]?.path.segments).toEqual(["first"]);
		expect(validate(second, {})[0]?.path.segments).toEqual(["second"]);
	});

	it("produces canonical missing, nested array, and escaped-property paths in stable order", () => {
		const schema = {
			type: "object",
			required: ["profile", "a/b~c"],
			properties: {
				"a/b~c": { type: "string", minLength: 1 },
				profile: {
					type: "object",
					required: ["contacts"],
					properties: {
						contacts: {
							type: "array",
							items: {
								type: "object",
								properties: {
									address: {
										type: "object",
										required: ["street/name~primary"],
									},
								},
							},
						},
					},
				},
			},
		} as const;
		const data = { profile: { contacts: [{ address: {} }] } };
		const first = validate(schema, data);
		expect(first.map((issue) => issue.path)).toEqual([
			{ namespace: "data", segments: ["a/b~c"] },
			{ namespace: "data", segments: ["profile", "contacts", 0, "address", "street/name~primary"] },
		]);
		expect(validate(schema, data)).toEqual(first);
		expect(first.every((issue) => issue.severity === "error")).toBe(true);
		expect(first.every((issue) => issue.source.origin === "json-schema-adapter")).toBe(true);
	});

	it("distinguishes required property presence from a present non-empty string", () => {
		const schema = {
			type: "object",
			required: ["name"],
			properties: { name: { type: "string", minLength: 1 } },
		} as const;
		expect(validate(schema, {}).map((issue) => issue.code)).toEqual(["json-schema.required"]);
		expect(validate(schema, { name: "" }).map((issue) => issue.code)).toEqual(["json-schema.minLength"]);
		expect(validate(schema, { name: "Ada" })).toEqual([]);
	});

	it("asserts email format explicitly", () => {
		const schema = {
			type: "object",
			properties: { email: { type: "string", format: "email" } },
		} as const;
		expect(validate(schema, { email: "not-an-email" })).toMatchObject([
			{ code: "json-schema.format", message: 'Must match the "email" format.' },
		]);
		expect(validate(schema, { email: "person@example.com" })).toEqual([]);
	});

	it("normalizes enum, const, number bounds, and integer failures", () => {
		const schema = {
			type: "object",
			properties: {
				role: { enum: ["Admin", "User"] },
				mode: { const: "create" },
				score: { type: "number", minimum: 0 },
				ratio: { type: "number", maximum: 10 },
				count: { type: "integer" },
			},
		} as const;
		expect(validate(schema, { role: "Guest", mode: "edit", score: -1, ratio: 11, count: 1.5 })).toMatchObject([
			{ code: "json-schema.type", path: { segments: ["count"] } },
			{ code: "json-schema.const", path: { segments: ["mode"] } },
			{ code: "json-schema.maximum", path: { segments: ["ratio"] } },
			{ code: "json-schema.enum", path: { segments: ["role"] } },
			{ code: "json-schema.minimum", path: { segments: ["score"] } },
		]);
	});

	it("guards an if/then/else discriminator for absent, false, and true data", () => {
		const schema = {
			$schema: "https://json-schema.org/draft/2020-12/schema",
			type: "object",
			properties: {
				followUp: { type: "boolean" },
				email: { type: "string", format: "email" },
			},
			if: { required: ["followUp"], properties: { followUp: { const: true } } },
			// biome-ignore lint/suspicious/noThenProperty: This is the JSON Schema conditional keyword.
			then: { required: ["email"], properties: { email: { minLength: 1 } } },
			else: { properties: { followUp: { const: false } } },
		} as const;
		expect(validate(schema, {})).toEqual([]);
		expect(validate(schema, { followUp: false })).toEqual([]);
		expect(validate(schema, { followUp: true }).map((issue) => issue.code)).toContain("json-schema.required");
		expect(validate(schema, { followUp: true, email: "bad" }).map((issue) => issue.code)).toContain(
			"json-schema.format",
		);
		expect(validate(schema, { followUp: true, email: "person@example.com" })).toEqual([]);
	});
});
