// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { getPlaygroundExamples } from "../playground/examples";
import { SchemaFormRuntime } from "../renderers/SchemaFormRuntime";
import { resolveTrustedRuntimeProfiles, trustedRuntimeProfileIds } from "../runtime/trusted-runtime-profiles";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const profileTable = {
	"formbar.standard.v1": ["validator:draft-2020-12", "repeater:formbar.repeater", "output:formbar.output"],
	"formbar.arbiter.v1": ["arbiter:formbar.arbiter"],
	"demo11.search-actions.v1": ["action:demo11.apply-filters"],
	"demo16.trusted-widgets.v1": [
		"widget:demo16.rating",
		"widget:demo16.color",
		"widget:demo16.checkbox-group",
		"widget:demo16.rich-options",
		"widget:demo16.range",
		"widget:demo16.progress",
	],
	"demo17.advanced-layout.v1": ["custom-node:demo17.inspection-panel", "custom-node:demo17.field-grid"],
} as const;

afterEach(() => document.body.replaceChildren());

describe("trusted runtime profile resolution", () => {
	it("resolves the exact finite catalog and capability table", () => {
		expect(trustedRuntimeProfileIds).toEqual(Object.keys(profileTable));
		for (const [profileId, expected] of Object.entries(profileTable)) {
			const result = resolveTrustedRuntimeProfiles([profileId]);
			expect(result.ok, profileId).toBe(true);
			expect(
				result.capabilities.map(({ kind, id }) => `${kind}:${id}`),
				profileId,
			).toEqual(expected);
		}
	});

	it("fails closed for unknown and duplicate IDs with deterministic diagnostics", () => {
		expect(resolveTrustedRuntimeProfiles(["outside.catalog"])).toEqual({
			ok: false,
			capabilities: [],
			diagnostics: [{ code: "unknown-profile", profileId: "outside.catalog" }],
		});
		expect(resolveTrustedRuntimeProfiles(["formbar.standard.v1", "formbar.standard.v1"]).diagnostics).toEqual([
			{ code: "duplicate-profile", profileId: "formbar.standard.v1" },
		]);
	});

	it("cannot expand the catalog through document data or a tampered component prop", () => {
		const example = getPlaygroundExamples()[0];
		expect(JSON.stringify(example.document)).not.toContain("profileIds");
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		act(() => root.render(<SchemaFormRuntime document={example.document} profileIds={["outside.catalog" as never]} />));
		expect(container.textContent).toContain("Trusted runtime profile rejected");
		expect(container.querySelector("form")).toBeNull();
		act(() => root.unmount());
	});
});
