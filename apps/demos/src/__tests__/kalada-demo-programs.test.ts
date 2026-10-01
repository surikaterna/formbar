import { describe, expect, it } from "vitest";
import { and, dataRef, uiRef } from "../demos/kalada-fixture-programs";
import { canonicalDefinition } from "../runtime/kalada-demo-programs";

describe("app-owned canonical Kalada program installation", () => {
	it("keeps explicitly authored canonical programs without modifying source", () => {
		const condition = and(dataRef("enabled"), uiRef("ready"));
		const definition = {
			root: {
				type: "conditional",
				condition,
				// biome-ignore lint/suspicious/noThenProperty: Serialized definition branch.
				then: [{ type: "output", value: dataRef("total") }],
			},
		};
		const installed = canonicalDefinition(definition);
		expect(installed.definition.root).toMatchObject({
			condition,
			// biome-ignore lint/suspicious/noThenProperty: Serialized definition branch.
			then: [{ value: dataRef("total") }],
		});
		expect(installed.uiPaths).toEqual([["ready"]]);
		expect(definition.root.condition).toBe(condition);
	});

	it("does not accept source-installed executable expressions", () => {
		expect(() => canonicalDefinition({ root: { condition: { kind: "literal", value: () => true } } })).toThrow();
	});
	it("rejects bare ref and op without a source grammar at the precise slot", () => {
		expect(() =>
			canonicalDefinition({ root: { condition: { kind: "ref", ref: { namespace: "data", segments: ["enabled"] } } } }),
		).toThrow(/root.condition: RE-AUTHOR/);
		expect(() =>
			canonicalDefinition({ root: { children: [{ type: "output", value: { kind: "op", op: "add", args: [] } }] } }),
		).toThrow(/root.children\[0\].value: RE-AUTHOR/);
	});
});
