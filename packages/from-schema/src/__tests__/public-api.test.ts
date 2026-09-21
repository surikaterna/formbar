import { describe, expect, it } from "vitest";
import * as api from "../index.js";

describe("from-schema public API", () => {
	it("exports graph projection and compilation without legacy flat or presentation APIs", () => {
		expect(Object.keys(api)).toEqual(
			expect.arrayContaining([
				"projectSchema",
				"projectSchemaDocument",
				"compileDefaultFormDefinition",
				"createSchemaForm",
				"jsonSchemaProvider",
			]),
		);
		for (const forbidden of [
			"ingestSchema",
			"extractFromJsonSchema",
			"registerExtractor",
			"compileLayout",
			"LayoutNodeRegistry",
			"applyLayoutMiddleware",
			"isJsonSchema",
		])
			expect(api).not.toHaveProperty(forbidden);
	});
});
