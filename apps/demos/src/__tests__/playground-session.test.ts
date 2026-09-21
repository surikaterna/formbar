import { describe, expect, it } from "vitest";
import { getPreset } from "../playground/presets";
import {
	applySources,
	createPlaygroundSession,
	resetSession,
	restorePlaygroundSession,
	updateSource,
} from "../playground/session";
import { type StorageLike, saveDraft } from "../playground/storage";

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

	it("restores version-2 editor sources after a reload without applying them", () => {
		const values = new Map<string, string>();
		const storage: StorageLike = {
			getItem: (key) => values.get(key) ?? null,
			setItem: (key, value) => values.set(key, value),
			removeItem: (key) => values.delete(key),
		};
		const sources = { ...createPlaygroundSession(presetDocument()).sources, initialData: '{"name":"Recovered"}' };
		expect(saveDraft(storage, "schema-compilation:default", sources)).toBe(true);
		const restored = restorePlaygroundSession(presetDocument(), "schema-compilation:default", storage);
		expect(restored.sources).toEqual(sources);
		expect(restored.applied).toBe(presetDocument());
		expect(restored.revision).toBe(0);
	});
});
