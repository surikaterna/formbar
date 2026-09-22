import { describe, expect, it } from "vitest";
import * as api from "../index.js";

describe("react-schema public API", () => {
	it("exports only the lean renderer surface without registry or legacy aliases", () => {
		expect(Object.keys(api).sort()).toEqual(["FormRenderer", "useSchemaForm"]);
		for (const forbidden of [
			"renderLayoutTree",
			"FieldRenderer",
			"RendererRegistry",
			"resolveFieldStates",
			"pruneHiddenFields",
		])
			expect(api).not.toHaveProperty(forbidden);
	});
});
