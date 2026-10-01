import { createKaladaV1Host } from "@formbar/declarative";
import { describe, expect, it } from "vitest";
import { serialHost } from "../../../../scripts/kalada-preflight/fixtures/row-write-hosts.js";
import { FormRenderer, useSchemaForm } from "../index.js";

const identity = { generation: "g1", fingerprint: "host" };
const policy = {
	...identity,
	widgets: {},
	renderers: { "demo.card": { children: "forbidden", props: { tone: { modes: ["literal"], expected: "string" } } } },
	actions: {},
	namespaces: { data: "available" },
	schema: { side: "input", availability: "complete", paths: [] },
	ui: { availability: "complete", paths: [] },
};

function rejected(root: unknown) {
	return () =>
		createKaladaV1Host({
			definition: { version: 1, id: "migration", root },
			policy,
			identity,
			strategy: serialHost().strategy,
			installed: { renderers: new Set(["demo.card"]) },
		});
}

describe("#376 explicit migration boundaries (#407/#408/#409)", () => {
	it("rejects the legacy hook and positional FormApi renderer, without an implicit adapter", () => {
		expect(() => useSchemaForm({}, {})).toThrow(/useSchemaForm is no longer supported/);
		expect(() => FormRenderer({ form: {}, definition: {} } as never)).toThrow("root: MISSING_STRATEGY");
	});

	it.each([
		["action", { type: "action", id: "save", action: "save" }],
		["output format", { type: "output", id: "formatted", value: { kind: "literal", value: "x" }, format: "currency" }],
	])("rejects unsupported %s instead of silently rendering legacy behavior", (_name, root) => {
		expect(rejected(root)).toThrow();
	});

	it.each([
		["tabs", { type: "tabs", id: "tabs", tabs: [] }],
		["accordion", { type: "accordion", id: "panels", items: [] }],
		["layout", { type: "group", id: "layout", presentation: { span: { base: "full" } }, children: [] }],
	])("projects supported %s without a legacy adapter", (_name, root) => {
		const host = rejected(root)();
		expect(host.snapshot().tree).toMatchObject({ type: root.type, nodeId: root.id });
		host.dispose();
	});

	it.each([
		["unknown renderer", { type: "custom", id: "unknown", renderer: "demo.unknown" }],
		[
			"unknown prop",
			{ type: "custom", id: "card", renderer: "demo.card", props: { private: { mode: "literal", value: "x" } } },
		],
		[
			"invalid prop",
			{ type: "custom", id: "card", renderer: "demo.card", props: { tone: { mode: "literal", value: 7 } } },
		],
		[
			"non-JSON function",
			{
				type: "custom",
				id: "card",
				renderer: "demo.card",
				props: { tone: { mode: "literal", value: () => "secret" } },
			},
		],
	])("rejects %s at the policy boundary, never executing serialized code", (_name, root) => {
		expect(rejected(root)).toThrow();
	});
});
