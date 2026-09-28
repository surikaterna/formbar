import { describe, expect, it } from "vitest";
import { admitKaladaDefinition } from "../../../packages/declarative/src/validators/kalada-definition.js";

const program = (expression: unknown) => ({ format: "kalada-program", version: 1, profile: "kalada-v1", expression });
const status = (id: string, key = "valid") =>
	program({ kind: "ref", ref: { namespace: "field", segments: [id, key] } });
const form = (key: string) => program({ kind: "ref", ref: { namespace: "form", segments: [key] } });
const binding = (name: string, scope?: string) => ({
	namespace: "data",
	segments: [name],
	...(scope ? { scope } : {}),
});
const field = (id: string, scope?: string) => ({ type: "field", id, widget: "text", binding: binding(id, scope) });
const output = (id: string, value: unknown) => ({ type: "output", id, value });
const thenKey = "then";

function definition() {
	return {
		version: 1,
		id: "form",
		root: {
			type: "group",
			id: "root",
			children: [
				output("first", status("top")),
				field("top"),
				{
					type: "repeater",
					id: "rows",
					scope: "rows",
					binding: binding("rows"),
					children: [
						output("own", status("row")),
						{
							type: "repeater",
							id: "nested",
							scope: "nested",
							binding: binding("nested", "rows"),
							children: [output("descendant", status("row")), field("deep", "nested")],
						},
						field("row", "rows"),
					],
				},
				{
					type: "repeater",
					id: "other",
					scope: "other",
					binding: binding("other"),
					children: [output("sibling", status("top")), field("otherField", "other")],
				},
			],
		},
		computations: [{ id: "unused", target: binding("computed"), expression: status("top") }],
	};
}

describe("private field status membership and lexical visibility", () => {
	it("accepts forward, repeated, own-row, descendant and top-level reads including unused computations", () => {
		const input = definition();
		input.root.children[0].value = program({
			kind: "boolean-logical",
			operator: "and",
			left: { kind: "ref", ref: { namespace: "field", segments: ["top", "valid"] } },
			right: { kind: "ref", ref: { namespace: "field", segments: ["top", "valid"] } },
		});
		const result = admitKaladaDefinition(input);
		expect(result.fields.size).toBe(4);
		expect(result.slots[0]?.dependencies).toEqual([{ namespace: "field", path: ["top", "valid"] }]);
		expect(result.computations[0]?.expression.dependencies).toEqual([{ namespace: "field", path: ["top", "valid"] }]);
	});

	it.each([
		["unknown ID", "root.children[0].value", "missing"],
		["non-field node", "root.children[0].value", "rows"],
		["top-level to row", "root.children[0].value", "row"],
		["outer row to nested", "root.children[2].children[0].value", "deep"],
		["sibling row", "root.children[3].children[0].value", "row"],
		["nested row to sibling", "root.children[2].children[1].children[0].value", "otherField"],
	] as const)("rejects %s at the original slot", (_reason, path, id) => {
		const input = definition();
		const entry =
			path === "root.children[2].children[0].value"
				? input.root.children[2].children[0]
				: path === "root.children[3].children[0].value"
					? input.root.children[3].children[0]
					: path === "root.children[2].children[1].children[0].value"
						? input.root.children[2].children[1].children[0]
						: input.root.children[0];
		entry.value = status(id);
		expect(() => admitKaladaDefinition(input)).toThrow(`${path}: INVALID_FIELD_REFERENCE`);
	});

	it("checks conditional, props, action payload and unused computation slots regardless of execution", () => {
		const input = definition();
		const path = "root.children[0]";
		for (const [node, suffix] of [
			[{ type: "conditional", id: "gate", condition: status("row"), [thenKey]: [] }, ".condition"],
			[{ type: "action", id: "act", action: "trusted.action", payload: status("row") }, ".payload"],
			[
				{
					type: "output",
					id: "out",
					value: form("valid"),
					props: { title: { mode: "read", expression: status("row") } },
				},
				".props.title.expression",
			],
		] as const) {
			const candidate = definition();
			candidate.root.children[0] = node as never;
			expect(() => admitKaladaDefinition(candidate)).toThrow(`${path}${suffix}: INVALID_FIELD_REFERENCE`);
		}
		input.computations[0].expression = status("row");
		expect(() => admitKaladaDefinition(input)).toThrow("computations[0].expression: INVALID_FIELD_REFERENCE");
	});

	it("checks a field status referenced only in a lazy branch", () => {
		const input = definition();
		const branch = "then";
		input.root.children[0].value = program({
			kind: "conditional",
			condition: { kind: "literal", value: false },
			[branch]: { kind: "ref", ref: { namespace: "field", segments: ["row", "valid"] } },
			else: { kind: "literal", value: true },
		});
		expect(() => admitKaladaDefinition(input)).toThrow("root.children[0].value: INVALID_FIELD_REFERENCE");
	});

	it("keeps form status bounded and reports malformed status at the inner reference path", () => {
		const input = definition();
		input.root.children[0].value = form("submitted");
		expect(() => admitKaladaDefinition(input)).not.toThrow();
		input.root.children[0].value = status("top", "submitted");
		expect(() => admitKaladaDefinition(input)).toThrow(
			"root.children[0].value.expression.ref: KALADA_INVALID_REFERENCE",
		);
		input.root.children[0].value = form("unknown");
		expect(() => admitKaladaDefinition(input)).toThrow(
			"root.children[0].value.expression.ref: KALADA_INVALID_REFERENCE",
		);
	});

	it("reports duplicate node ID at the declaration even if a status references it", () => {
		const input = definition();
		input.root.children[1].id = "first";
		expect(() => admitKaladaDefinition(input)).toThrow("root.children[1].id: DUPLICATE_NODE_ID");
	});
});
