import { execFileSync } from "node:child_process";
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

	it("publishes runtime source without test source trees", () => {
		const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
		expect(manifest.files).toEqual(["dist", "src/*.ts"]);
		expect(manifest.files).not.toContain("src");
		const packageDirectory = new URL("../..", import.meta.url);
		const output = execFileSync("npm", ["pack", "--dry-run", "--json"], {
			cwd: packageDirectory,
			encoding: "utf8",
		});
		const paths = JSON.parse(output)[0].files.map((file: { path: string }) => file.path);
		expect(paths).toContain("src/index.ts");
		expect(paths.some((path: string) => path.includes("/__tests__/") || path.includes(".test."))).toBe(false);
	});
});
