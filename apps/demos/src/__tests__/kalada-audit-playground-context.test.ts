import { describe, expect, it } from "vitest";
import { formatJson, parseDocument, stringifyDocument } from "../playground/document";
import { getPlaygroundExample } from "../playground/examples";
import { applySources, createPlaygroundSession, updateCurrentSource, updateSource } from "../playground/session";

const selected = [
	["custom-renderers", "schema-hints"],
	["custom-renderers", "authored-overrides"],
	["custom-layout-types", "vessel-inspection:sections"],
	["custom-layout-types", "vessel-inspection:tabs"],
	["custom-layout-types", "vessel-inspection:accordion"],
	["search-filters", "default"],
	["arbiter-visibility", "default"],
	["arbiter-calculated", "default"],
	["arbiter-validation-gating", "default"],
	["arbiter-dynamic-sections", "default"],
] as const;
function preset(demo: string, variant: string) {
	const result = getPlaygroundExample(demo, variant);
	if (!result) throw new Error(`Missing selected preset ${demo}:${variant}`);
	return result;
}

describe("R13 selected preset authority remains separate from authored JSON", () => {
	it.each(selected)("untouched and harmless label Apply succeeds for %s:%s", (demo, variant) => {
		const example = preset(demo, variant);
		const original = createPlaygroundSession(example.document, example.runtime);
		const untouched = applySources(original);
		expect(untouched.errors).toEqual({});
		expect(untouched.revision).toBe(1);
		const schema = { ...example.document.schema, title: "Edited display label" };
		const edited = applySources(updateSource(untouched, "schema", formatJson(schema)));
		expect(edited.errors).toEqual({});
		expect(edited.revision).toBe(2);
		expect(edited.applied.schema.title).toBe("Edited display label");
		expect(edited.runtime).toBe(original.runtime);
		expect(edited.sources).not.toHaveProperty("profileIds");
	});

	it("retains the edited draft across display changes without rewriting authored Initial Data", () => {
		const example = preset("custom-renderers", "authored-overrides");
		const session = createPlaygroundSession(example.document, example.runtime);
		const live = { ...example.document.initialData, productName: "User edited product" };
		const changed = updateSource(session, "schema", formatJson({ ...example.document.schema, title: "Label only" }));
		const applied = applySources(changed, live);
		expect(applied.errors).toEqual({});
		expect(applied.previewData).toEqual(live);
		expect(applied.applied.initialData).toEqual(example.document.initialData);
		const dataEdit = applySources(
			updateSource(applied, "initialData", formatJson({ productName: "Authored replacement" })),
			live,
		);
		expect(dataEdit.previewData).toBeUndefined();
		expect(dataEdit.applied.initialData).toEqual({ productName: "Authored replacement" });
	});

	it("a profile switch or successful Apply invalidates a captured source callback", () => {
		const widgets = preset("custom-renderers", "authored-overrides");
		const layout = preset("custom-layout-types", "vessel-inspection:tabs");
		const old = createPlaygroundSession(widgets.document, widgets.runtime);
		const next = createPlaygroundSession(layout.document, layout.runtime);
		expect(updateCurrentSource(next, old, "definition", "stale JSON")).toBe(next);
		const applied = applySources(old);
		expect(updateCurrentSource(applied, old, "schema", "stale schema")).toBe(applied);
		expect(applied.runtime.profileIds).toEqual(widgets.runtime.profileIds);
		expect(next.runtime.profileIds).toEqual(layout.runtime.profileIds);
	});

	it("JSON cannot infer profiles or grant an unknown renderer; unknown selected profiles also refuse", () => {
		const example = preset("custom-renderers", "authored-overrides");
		expect(parseDocument(stringifyDocument(example.document)).ok).toBe(false);
		const unknown = parseDocument(stringifyDocument(example.document), {
			...example.runtime,
			profileIds: ["outside.catalog" as never],
		});
		expect(unknown.ok).toBe(false);
		if (!unknown.ok) expect(unknown.errors.definition).toContain("unknown-profile");
		const bad = structuredClone(example.document);
		const definition = JSON.parse(JSON.stringify(bad.definition));
		definition.root.children[0].widget = "unregistered.editor";
		const sources = { ...stringifyDocument(bad), definition: formatJson(definition) };
		const rejected = parseDocument(sources, example.runtime);
		expect(rejected.ok).toBe(false);
		if (!rejected.ok) expect(rejected.errors.definition).toContain("MISSING_TRUSTED_RENDERER");
	});
});
