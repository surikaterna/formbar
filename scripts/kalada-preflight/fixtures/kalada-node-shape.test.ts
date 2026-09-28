import { describe, expect, it } from "vitest";
import { admitKaladaDefinition } from "../../../packages/declarative/src/validators/kalada-definition.js";

const ref = { namespace: "data", segments: ["rows"] };
const program = {
	format: "kalada-program",
	version: 1,
	profile: "kalada-v1",
	expression: { kind: "literal", value: true },
};
const node = (type: string, extra: Record<string, unknown> = {}) => ({ id: "child", type, ...extra });
const form = (root: unknown, submission?: unknown) => ({
	version: 1,
	id: "form",
	root,
	...(submission === undefined ? {} : { submission }),
});
const nested = (child: unknown) =>
	form({
		type: "tabs",
		id: "root",
		tabs: [
			{
				id: "tab",
				label: "",
				children: [{ type: "accordion", id: "inner", items: [{ id: "item", label: "ok", children: [child] }] }],
			},
		],
	});
const path = "root.tabs[0].children[0].items[0].children[0]";

describe("private actual V1 node shape (not public validation)", () => {
	it.each([
		["group", { label: "", children: [] }],
		["section", { title: "", description: "", children: [] }],
		["field", { binding: ref, widget: "text", label: "", submitWhenHidden: "include" }],
		["repeater", { binding: ref, scope: "rows", label: "", minItems: 0, maxItems: 0, children: [] }],
		["action", { action: "submit", label: "", concurrency: "queue" }],
		["action", { action: "array.remove", target: ref }],
		["action", { action: "array.append", target: ref, payload: program }],
		["output", { value: program, label: "", format: "percent" }],
		["validation", { binding: ref, messages: ["", "required"] }],
		["custom", { renderer: "card", children: [] }],
	] as const)("admits nested %s", (type, extra) => {
		expect(() => admitKaladaDefinition(nested(node(type, extra)))).not.toThrow();
	});

	it.each([
		["group", { label: 1, children: [] }, "label", "INVALID_SHAPE"],
		["section", { title: false, children: [] }, "title", "INVALID_SHAPE"],
		["section", { description: null, children: [] }, "description", "INVALID_SHAPE"],
		["field", { binding: ref }, "widget", "INVALID_ID"],
		["field", { binding: ref, widget: "text", submitWhenHidden: "omit" }, "submitWhenHidden", "INVALID_SHAPE"],
		["repeater", { binding: ref, scope: "rows", children: [], minItems: -1 }, "minItems", "INVALID_SHAPE"],
		["repeater", { binding: ref, scope: "rows", children: [], maxItems: 1.5 }, "maxItems", "INVALID_SHAPE"],
		["repeater", { binding: ref, scope: "rows", children: [], minItems: 2, maxItems: 1 }, "maxItems", "INVALID_SHAPE"],
		[
			"repeater",
			{ binding: ref, scope: "rows", children: [], maxItems: Number.MAX_SAFE_INTEGER + 1 },
			"maxItems",
			"INVALID_SHAPE",
		],
		["action", { action: "submit", payload: program }, "payload", "INVALID_ACTION_PAYLOAD"],
		["action", { action: "reset", target: ref }, "target", "INVALID_ACTION_TARGET"],
		["action", { action: "array.insert", target: ref }, "payload", "INVALID_ACTION_PAYLOAD"],
		["action", { action: "array.swap", payload: program }, "target", "INVALID_ACTION_TARGET"],
		["action", { action: "validate", concurrency: "parallel" }, "concurrency", "INVALID_SHAPE"],
		["action", {}, "action", "INVALID_ID"],
		["output", { value: program, format: "html" }, "format", "INVALID_SHAPE"],
		["custom", {}, "renderer", "INVALID_ID"],
		["validation", { binding: ref, messages: [1] }, "messages[0]", "INVALID_SHAPE"],
	] as const)("rejects nested %s declaration at %s", (type, extra, suffix, code) => {
		expect(() => admitKaladaDefinition(nested(node(type, extra)))).toThrow(`${path}.${suffix}: ${code}`);
	});

	it.each([
		[{ span: 1 }, undefined],
		[{ span: "auto" }, undefined],
		[{ span: "full" }, undefined],
		[{ span: { base: 12, md: "auto", xl: "full" } }, undefined],
		[{ span: {} }, undefined],
		[{}, undefined],
		[{ span: 0 }, "span"],
		[{ span: 13 }, "span"],
		[{ span: { xs: 1 } }, "span.xs"],
		[{ span: { md: false } }, "span.md"],
		[{ extra: true }, "extra"],
		[null, ""],
	] as const)("checks presentation %j", (presentation, suffix) => {
		const check = () => admitKaladaDefinition(nested(node("group", { children: [], presentation })));
		if (suffix === undefined) expect(check).not.toThrow();
		else
			expect(check).toThrow(
				`${path}.presentation${suffix ? `.${suffix}` : ""}: ${suffix === "extra" || suffix === "span.xs" ? "UNKNOWN_KEY" : "INVALID_SHAPE"}`,
			);
	});

	it("checks collection entries, submission, and empty top-level nodes", () => {
		for (const value of ["include", "omit-inactive"])
			expect(() => admitKaladaDefinition(form(node("group", { children: [] }), { hiddenValues: value }))).not.toThrow();
		for (const root of [node("tabs", { tabs: [] }), node("accordion", { items: [] })])
			expect(() => admitKaladaDefinition(form(root))).not.toThrow();
		for (const [entry, suffix, code] of [
			[{ id: "tab", children: [] }, "label", "INVALID_SHAPE"],
			[{ id: "tab", label: 1, children: [] }, "label", "INVALID_SHAPE"],
			[{ id: "tab", label: "" }, "children", "INVALID_SHAPE"],
		] as const)
			for (const key of ["tabs", "items"] as const)
				expect(() =>
					admitKaladaDefinition(form(node(key === "tabs" ? "tabs" : "accordion", { [key]: [entry] }))),
				).toThrow(`root.${key}[0].${suffix}: ${code}`);
		for (const value of [null, {}, { hiddenValues: "omit" }, { hiddenValues: "include", extra: true }])
			expect(() => admitKaladaDefinition(form(node("group", { children: [] }), value))).toThrow();
	});

	it("keeps expression slots on the private Kalada boundary", () => {
		expect(() => admitKaladaDefinition(nested(node("output", { value: { kind: "literal", value: true } })))).toThrow(
			`${path}.value: RE-AUTHOR`,
		);
	});
});
