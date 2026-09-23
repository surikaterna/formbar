import { describe, expect, it } from "vitest";
import { SOURCE_LIMIT_BYTES } from "../playground/contracts";
import { parseDocument, stringifyDocument } from "../playground/document";
import { getPlaygroundExample } from "../playground/examples";

function validSources() {
	const preset = getPlaygroundExample("schema-compilation");
	if (!preset) throw new Error("missing test preset");
	return stringifyDocument(preset.document);
}

describe("playground document v2", () => {
	it.each([
		["schema", "[]", "object"],
		["definition", "[]", "object"],
		["initialData", "[]", "object"],
	] as const)("reports a shape error for %s", (key, value, message) => {
		const result = parseDocument({ ...validSources(), [key]: value });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors[key]).toContain(message);
	});

	it("validates authored definitions with the declarative validator", () => {
		const result = parseDocument({ ...validSources(), definition: '{"version":0}' });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors.definition).toContain("Definition is invalid");
	});

	it("rejects invalid JSON and oversized schemas", () => {
		expect(parseDocument({ ...validSources(), definition: "[trailing,]" }).ok).toBe(false);
		const result = parseDocument({ ...validSources(), schema: `{"value":"${"x".repeat(SOURCE_LIMIT_BYTES)}"}` });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors.schema).toContain("exceeds");
	});

	it.each([
		["negative keyword bound", { type: "object", minProperties: -1 }],
		["malformed keyword shape", { type: "object", required: "name" }],
		["unresolved local reference", { $ref: "#/$defs/missing", $defs: {} }],
	] as const)("rejects a Draft 2020-12 schema with %s", (_case, schema) => {
		const result = parseDocument({ ...validSources(), schema: JSON.stringify(schema) });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors.schema).toContain("Schema is not valid Draft 2020-12");
	});
});
