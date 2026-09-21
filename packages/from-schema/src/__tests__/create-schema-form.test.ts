import { describe, expect, it } from "vitest";
import { InvalidFormDefinitionError, createSchemaForm, jsonSchemaProvider, standardSchemaProvider } from "../index.js";

describe("createSchemaForm", () => {
	it("returns validated preparation artifacts with separate deterministic diagnostics", () => {
		const result = createSchemaForm({ type: "string" }, { provider: jsonSchemaProvider(), side: "input" });
		expect(result.definition.version).toBe(1);
		expect(result.diagnostics).toEqual({ source: [], projection: [], compilation: [], definition: [] });
		expect(result.validators).toEqual([]);
	});

	it("requires authored definition and generation options to be mutually exclusive", () => {
		const definition = {
			version: 1 as const,
			id: "authored",
			root: { id: "root", type: "group" as const, children: [] },
		};
		expect(() =>
			createSchemaForm({}, { provider: jsonSchemaProvider(), side: "input", definition, generation: {} }),
		).toThrow(/mutually exclusive/);
	});

	it("rejects invalid authored definitions instead of translating them", () => {
		expect(() =>
			createSchemaForm(
				{},
				{
					provider: jsonSchemaProvider(),
					side: "input",
					definition: { version: 1, id: "invalid", root: { id: "root", type: "legacy" } } as never,
				},
			),
		).toThrow(InvalidFormDefinitionError);
	});

	it("keeps a source validator handle independent from caller validators", () => {
		const schema = {
			"~standard": {
				version: 1 as const,
				vendor: "test",
				validate: (value: unknown) => ({ value }),
			},
		};
		const validator = () => [];
		const result = createSchemaForm(schema, {
			provider: standardSchemaProvider(),
			side: "input",
			validators: [validator],
		});
		expect(result.sourceValidator).toBe(schema);
		expect(result.validators).toEqual([validator]);
	});
});
