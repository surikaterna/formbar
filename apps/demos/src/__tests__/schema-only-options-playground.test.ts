import { describe, expect, it } from "vitest";
import { parseDocument, stringifyDocument } from "../playground/document";
import { getPlaygroundExample } from "../playground/examples";
import { createJsonSchemaValidator } from "../validation/json-schema-validator";

describe("schema-only options playground", () => {
	it("recompiles the edited schema without an authored definition and preserves initial JSON", () => {
		const example = getPlaygroundExample("basic-contact", "schema-options");
		if (!example) throw new Error("Missing schema-only preset");
		expect(example.document.definition).toBeNull();
		const sources = stringifyDocument(example.document);
		const parsed = parseDocument({ ...sources, schema: sources.schema.replace("Team lead", "Team captain") });
		expect(parsed.ok).toBe(true);
		if (parsed.ok) {
			expect(parsed.document.definition).toBeNull();
			expect(parsed.document.initialData).toEqual({ role: "lead" });
			expect(JSON.stringify(parsed.document.schema)).toContain("Team captain");
		}
	});

	it("keeps the demo's independent source validator authoritative for enum and options-only", () => {
		const schema = {
			type: "object",
			properties: {
				role: { type: "string", enum: ["qa"], "x-formbar": { options: [{ value: "qa", disabled: true }] } },
				other: { type: "string", "x-formbar": { options: ["suggestion"] } },
			},
		};
		const validate = createJsonSchemaValidator(schema);
		expect(validate({ data: { role: "qa", other: "unlisted" }, uiState: {} })).toEqual([]);
		expect(validate({ data: { role: "outside", other: "unlisted" }, uiState: {} })).not.toEqual([]);
	});
});
