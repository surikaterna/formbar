import { expect, it, vi } from "vitest";
import { createFormRuntime, validateFormDefinition } from "../../../packages/declarative/src/index.js";
import { projectRuntime } from "../../../packages/declarative/src/runtime-projection.js";
import { serialHost } from "./row-write-hosts.js";

const identity = { generation: "g1", fingerprint: "host" };
const target = { namespace: "data", segments: ["profile", "name"] };
const slot = {
	format: "kalada-program",
	version: 1,
	profile: "kalada-v1",
	expression: { kind: "literal", value: true },
};
const definition = {
	version: 1,
	id: "public",
	root: { type: "field", id: "name", widget: "text", binding: target, required: slot },
};
const admission = () => ({
	policy: {
		...identity,
		widgets: {},
		renderers: {},
		actions: {},
		namespaces: { data: "available" },
		schema: { side: "input", availability: "complete", paths: [{ path: target.segments, kind: "value" }] },
		ui: { availability: "complete", paths: [] },
	},
	identity,
	strategy: serialHost().strategy,
	writeSources: { "root.binding": "profile.name" },
	directLocations: {
		"root.binding": {
			profile: {
				target: { namespace: "data" as const, segments: ["profile"] },
				type: { kind: "primitive-type" as const, name: "json" as const },
				writable: true as const,
				properties: {
					name: { type: { kind: "primitive-type" as const, name: "string" as const }, writable: true as const },
				},
			},
		},
	},
});

it("admits only fully installed host-backed Kalada V1 and never evaluates through positional FormApi", () => {
	const result = validateFormDefinition(definition, admission());
	expect(result.ok).toBe(true);
	if (!result.ok) return;
	expect(result.value.prepared.admitted.slots.map((entry) => entry.path)).toEqual(["root.required"]);
	const captureState = vi.fn(() => {
		throw new Error("old evaluator invoked");
	});
	const runtime = createFormRuntime({ definition: result.value });
	expect(runtime.snapshot().controls[0]).toMatchObject({ nodeId: "name", required: true });
	expect(captureState).not.toHaveBeenCalled();
	expect(() => projectRuntime({ definition: result.value, form: { captureState } as never })).toThrow(
		"UNSUPPORTED_V1_RE-AUTHOR",
	);
	expect(captureState).not.toHaveBeenCalled();
	runtime.dispose();
	expect(() => createFormRuntime({ definition: { ...result.value, prepared: undefined } as never })).toThrow(
		"MISSING_STRATEGY",
	);
});

it("admits host-backed actions but rejects legacy action payloads at the exact slot", () => {
	const action = { version: 1, id: "action", root: { type: "action", id: "send", action: "submit", visible: slot } };
	expect(validateFormDefinition(action, { ...admission(), writeSources: {} }).ok).toBe(true);
	expect(
		validateFormDefinition(
			{ ...action, root: { ...action.root, visible: { kind: "literal", value: true } } },
			{ ...admission(), writeSources: {} },
		),
	).toMatchObject({
		ok: false,
		diagnostics: [{ path: ["root", "visible"], message: "RE-AUTHOR" }],
	});
});

it("reports exact RE-AUTHOR slot paths and rejects missing host evidence", () => {
	const old = { ...definition, root: { ...definition.root, required: { kind: "literal", value: true } } };
	expect(validateFormDefinition(old, admission())).toMatchObject({
		ok: false,
		diagnostics: [{ path: ["root", "required"], message: "RE-AUTHOR" }],
	});
	expect(validateFormDefinition(definition)).toMatchObject({
		ok: false,
		diagnostics: [{ path: ["root"], message: "MISSING_POLICY" }],
	});
	expect(validateFormDefinition(definition, { ...admission(), writeSources: {} })).toMatchObject({
		ok: false,
		diagnostics: [{ path: ["root", "binding"], message: "MISSING_WRITER" }],
	});
	expect(validateFormDefinition(definition, { ...admission(), directLocations: undefined })).toMatchObject({
		ok: false,
		diagnostics: [{ path: ["root", "binding"], message: "UNSUPPORTED_WRITE_TARGET_RE-AUTHOR" }],
	});
	expect(
		validateFormDefinition(
			{ ...definition, root: { ...definition.root, presentation: { span: "full" } } },
			admission(),
		),
	).toMatchObject({ ok: true });
});
