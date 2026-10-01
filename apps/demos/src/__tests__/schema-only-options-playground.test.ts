import { describe, expect, it } from "vitest";
import { parseDocument, stringifyDocument } from "../playground/document";
import { getPlaygroundExample } from "../playground/examples";
import { createJsonSchemaValidator } from "../validation/json-schema-validator";

describe("schema-only options playground", () => {
	it("projects a null-definition preset and accepts schema-only edits through the installed host", () => {
		const example = getPlaygroundExample("basic-contact", "schema-options");
		if (!example) throw new Error("Missing schema-only preset");
		expect(example.document.definition).toBeNull();
		expect(example.runtime.capabilities).toContainEqual({ kind: "action", id: "submit" });
		expect(example.runtime.capabilities).toContainEqual({ kind: "action", id: "reset" });
		const sources = stringifyDocument(example.document);
		const parsed = parseDocument({ ...sources, schema: sources.schema.replace("Team lead", "Team captain") });
		expect(sources.definition.trim()).toBe("null");
		expect(JSON.parse(sources.initialData)).toEqual({ role: "lead" });
		expect(parsed).toMatchObject({ ok: true, document: { definition: null } });
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
