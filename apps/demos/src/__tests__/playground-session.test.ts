import { describe, expect, it } from "vitest";
import { getPreset } from "../playground/presets";
import { applySources, createPlaygroundSession, resetSession, updateSource } from "../playground/session";

function presetDocument() {
	const preset = getPreset("schema-compilation");
	if (!preset) throw new Error("missing test preset");
	return preset.document;
}

describe("playground session", () => {
	it("keeps the last compiled document when a source fails", () => {
		const original = createPlaygroundSession(presetDocument());
		const result = applySources(updateSource(original, "definition", "not-json"));
		expect(result.applied).toBe(original.applied);
		expect(result.revision).toBe(0);
		expect(result.errors.definition).toBeTruthy();
	});

	it("applies v2 sources atomically", () => {
		const original = createPlaygroundSession(presetDocument());
		const applied = applySources(updateSource(original, "initialData", '{"name":"Ada"}'));
		expect(applied.applied.initialData).toEqual({ name: "Ada" });
		expect(applied.revision).toBe(1);
		expect(resetSession(applied, presetDocument()).revision).toBe(2);
	});
});
