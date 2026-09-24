import { describe, expect, it } from "vitest";
import { assertValidRegistry, demos } from "../demos/registry";
import { parseDocument, stringifyDocument } from "../playground/document";
import { exampleVariant, getPlaygroundCompatibility, getPlaygroundExamples } from "../playground/examples";

const expectedMatrix = [
	"basic-contact:default",
	"user-profile:default",
	"nested-address:default",
	"settings-panel:default",
	"product-entry:default",
	"rich-validation:default",
	"conditional-fields:default",
	"array-items:default",
	"custom-layout:default",
	"multi-section-responsive:default",
	"search-filters:default",
	"survey:default",
	"multi-schema-sources:minimal",
	"multi-schema-sources:explicit",
	"order-entry:default",
	"kitchen-sink:default",
	"custom-renderers:schema-hints",
	"custom-renderers:authored-overrides",
	"custom-renderers:extension-diagnostics",
	"custom-layout-types:vessel-inspection:sections",
	"custom-layout-types:vessel-inspection:tabs",
	"custom-layout-types:vessel-inspection:accordion",
	"arbiter-visibility:default",
	"arbiter-calculated:default",
	"arbiter-validation-gating:default",
	"arbiter-dynamic-sections:default",
	"schema-compilation:default",
	"basic-contact:schema-options",
] as const;

describe("registry-derived playground projection", () => {
	it("is total, ordered, unique, and includes the schema-only preset", () => {
		assertValidRegistry(demos);
		expect(demos.filter(({ number }) => number !== undefined).map(({ number }) => number)).toEqual(
			Array.from({ length: 21 }, (_, index) => index + 1),
		);
		expect(demos.every(({ playground }) => playground.support === "full")).toBe(true);
		const examples = getPlaygroundExamples();
		expect(
			examples.map(({ demoId, sourceKey, definitionKey }) =>
				[demoId, sourceKey, definitionKey].filter(Boolean).join(":"),
			),
		).toEqual(expectedMatrix);
		expect(examples.filter(({ number }) => number !== undefined)).toHaveLength(27);
		expect(new Set(examples.map(({ key }) => key)).size).toBe(28);
	});

	it("materializes deep-frozen serializable definitions and preflights every example", () => {
		for (const example of getPlaygroundExamples()) {
			expect(JSON.parse(JSON.stringify(example)), example.key).toEqual(example);
			expect(Object.isFrozen(example), example.key).toBe(true);
			expect(Object.isFrozen(example.document.definition), example.key).toBe(true);
			expect(parseDocument(stringifyDocument(example.document)), example.key).toEqual({
				ok: true,
				document: example.document,
			});
		}
	});

	it("derives route compatibility and stable variants from the same registry", () => {
		const compatibility = getPlaygroundCompatibility();
		expect(compatibility.map(({ demoId }) => demoId)).toEqual(demos.map(({ id }) => id));
		for (const entry of compatibility) {
			const variants = getPlaygroundExamples()
				.filter(({ demoId }) => demoId === entry.demoId)
				.map(exampleVariant);
			expect(
				entry.presets.map(({ variant }) => variant),
				entry.demoId,
			).toEqual(variants);
		}
	});

	it("rejects duplicate IDs and empty unsupported reasons", () => {
		expect(() => assertValidRegistry([...demos, demos[0]])).toThrow("Duplicate demo ID");
		const compilation = demos.at(-1);
		if (!compilation) throw new Error("Missing compilation registration");
		expect(() =>
			assertValidRegistry([{ ...compilation, playground: { support: "unsupported", reason: " " } }]),
		).toThrow("requires a reason");
	});
});
