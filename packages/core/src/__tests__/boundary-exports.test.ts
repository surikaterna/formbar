import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Boundary test — asserts the public API surface is stable.
 * If this test fails, it means exports were accidentally added/removed.
 */
describe("@formbar/core public API surface", () => {
	it("exports expected symbols from main entry", async () => {
		const mod = await import("../index.js");
		const exports = Object.keys(mod).sort();

		// Snapshot the expected public API
		expect(exports).toEqual(
			expect.arrayContaining([
				"FormStore",
				"FormbarError",
				"Transaction",
				"applyRuleWrites",
				"applySubmitOutcome",
				"clearChildFieldMeta",
				"createConfigurableDateEgressTransform",
				"createDateEgressTransform",
				"createDateTransform",
				"createFieldApi",
				"createFieldTransform",
				"createForm",
				"createListenerRegistry",
				"createStandardSchemaValidator",
				"dedupeIssues",
				"deepFreeze",
				"defaultStrategy",
				"deleteNestedValue",
				"disposeMiddlewares",
				"executePipeline",
				"initMiddlewares",
				"isStandardSchemaLike",
				"mergeFieldConfig",
				"normalizeIssues",
				"parsePath",
				"runNotifyHooksAsync",
				"runNotifyHooksSync",
				"runTransforms",
				"runVetoHooksAsync",
				"runVetoHooksSync",
				"setNestedValue",
				"shiftFieldMeta",
				"shouldShowIssues",
				"sortIssues",
				"structuredEqual",
				"swapFieldMeta",
				"toDot",
				"toPointer",
				"withTimeout",
			]),
		);
	});

	it("does not leak internal symbols", async () => {
		const mod = await import("../index.js");
		const exports = Object.keys(mod);

		// These should NOT be exported
		const internals = [
			"createValidationCoordinator",
			"pathEquals",
			"pathStartsWith",
			"generateSubmitId",
			"resolveInitialValue",
		];
		for (const name of internals) {
			expect(exports).not.toContain(name);
		}
	});

	it("declares the repository source-free package policy", () => {
		const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
		expect(manifest.files).toEqual(["dist"]);
	});
});
