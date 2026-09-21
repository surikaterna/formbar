import { describe, expect, it } from "vitest";
import * as api from "../index.js";

describe("react-schema public API", () => {
	it("contains no renderer, registry, pruning, or resolved-state surface", () => {
		expect(Object.keys(api)).toEqual(["useSchemaForm"]);
		for (const forbidden of ["renderLayoutTree", "RendererRegistry", "resolveFieldStates", "pruneHiddenFields"])
			expect(api).not.toHaveProperty(forbidden);
	});
});
