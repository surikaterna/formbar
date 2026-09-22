import { describe, expect, it } from "vitest";
import { demos } from "../demos";
import { parseDocument, stringifyDocument } from "../playground/document";
import { compatibilityMatrix } from "../playground/presets";

describe("compilation preview presets", () => {
	it("keeps only the truthful compilation preview in the unchanged preset matrix", () => {
		expect(demos.filter((demo) => demo.category === "compilation").map((demo) => demo.id)).toEqual([
			"schema-compilation",
		]);
		expect(compatibilityMatrix.map(({ demoId, support }) => [demoId, support])).toEqual([
			["schema-compilation", "full"],
		]);
	});

	it("preflights every v2 preset without a renderer bridge", () => {
		for (const compatibility of compatibilityMatrix) {
			for (const preset of compatibility.presets) {
				expect(parseDocument(stringifyDocument(preset.document)), preset.key).toEqual({
					ok: true,
					document: preset.document,
				});
			}
		}
	});
});
