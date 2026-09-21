import { describe, expect, it } from "vitest";
import { demos } from "../demos";
import { parseDocument, stringifyDocument } from "../playground/document";
import { compatibilityMatrix } from "../playground/presets";

describe("compilation preview presets", () => {
	it("publishes only the truthful compilation preview", () => {
		expect(demos.map((demo) => [demo.id, demo.category])).toEqual([["schema-compilation", "compilation"]]);
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
