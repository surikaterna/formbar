// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { getPlaygroundExamples } from "../playground/examples";
import { applySources, createPlaygroundSession, updateSource } from "../playground/session";
import { SchemaFormRuntime } from "../renderers/SchemaFormRuntime";
import { runtimeProfileIdsFor } from "../runtime/runtime-profile-selection";
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

const hostileProfileIds = [
	"toString",
	"__proto__",
	"constructor",
	"Symbol(formbar.standard.v1)",
	"",
	"FORMBAR.STANDARD.V1",
] as const;

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

	it.each(hostileProfileIds)("rejects the exact hostile profile ID %j", (profileId) => {
		expect(resolveTrustedRuntimeProfiles([profileId])).toEqual({
			ok: false,
			capabilities: [],
			diagnostics: [{ code: "unknown-profile", profileId }],
		});
	});

	it("rejects a non-string Symbol without property coercion", () => {
		expect(resolveTrustedRuntimeProfiles([Symbol("formbar.standard.v1") as never])).toEqual({
			ok: false,
			capabilities: [],
			diagnostics: [{ code: "unknown-profile", profileId: "Symbol(formbar.standard.v1)" }],
		});
	});

	it("assembles standard, Arbiter, and fixture profiles once in deterministic order", () => {
		expect(runtimeProfileIdsFor({ runtimeProfileIds: ["demo11.search-actions.v1"] }, { arbiterRules: [] })).toEqual([
			"formbar.standard.v1",
			"formbar.arbiter.v1",
			"demo11.search-actions.v1",
		]);
		expect(runtimeProfileIdsFor({}, {})).toEqual(["formbar.standard.v1"]);
	});

	it("keeps nested editor profile-like data inert and outside runtime selection", () => {
		const example = getPlaygroundExamples()[0];
		const session = createPlaygroundSession(example.document);
		const nested = JSON.stringify({ nested: { profileIds: hostileProfileIds } });
		const applied = applySources(updateSource(session, "initialData", nested));
		expect(applied.errors).toEqual({});
		expect(applied.applied.initialData).toEqual({ nested: { profileIds: hostileProfileIds } });
		expect(example.runtime.profileIds).toEqual(["formbar.standard.v1"]);
	});

	it.each(hostileProfileIds)("renders no form for tampered profile prop %j", (profileId) => {
		const example = getPlaygroundExamples()[0];
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		act(() => root.render(<SchemaFormRuntime document={example.document} profileIds={[profileId as never]} />));
		expect(container.textContent).toContain("Trusted runtime profile rejected");
		expect(container.textContent).toContain(`"profileId": "${profileId}"`);
		expect(container.querySelector("form")).toBeNull();
		act(() => root.unmount());
	});
});
