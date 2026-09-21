import { describe, expect, it } from "vitest";
import { validateFormDefinition } from "../index.js";
import { binding, literal, ref } from "./fixtures.js";

const definition = (computations: readonly unknown[]) => ({
	version: 1,
	id: "computed",
	root: { type: "group", id: "root", children: [] },
	computations,
});

describe("stored computation graph", () => {
	it("derives expression dependencies and accepts an acyclic graph", () => {
		const result = validateFormDefinition(
			definition([
				{ id: "subtotal", target: binding(["subtotal"]), expression: ref(["quantity"]) },
				{
					id: "total",
					target: binding(["total"]),
					expression: { kind: "op", op: "add", args: [ref(["subtotal"]), literal(1)] },
				},
			]),
		);
		expect(result.ok).toBe(true);
	});

	it.each([
		[
			"duplicate IDs",
			[
				{ id: "same", target: binding(["a"]), expression: literal(1) },
				{ id: "same", target: binding(["b"]), expression: literal(2) },
			],
			"duplicate-computation-id",
		],
		[
			"duplicate targets",
			[
				{ id: "a", target: binding(["same"]), expression: literal(1) },
				{ id: "b", target: binding(["same"]), expression: literal(2) },
			],
			"duplicate-computation-target",
		],
		["self dependencies", [{ id: "a", target: binding(["a"]), expression: ref(["a"]) }], "self-dependency"],
		[
			"cycles",
			[
				{ id: "a", target: binding(["a"]), expression: ref(["b"]) },
				{ id: "b", target: binding(["b"]), expression: ref(["a"]) },
			],
			"computation-cycle",
		],
	])("rejects %s", (_name, declarations, expected) => {
		const result = validateFormDefinition(definition(declarations));
		expect(result).toMatchObject({ ok: false });
		if (!result.ok) expect(result.diagnostics.map(({ code }) => code)).toContain(expected);
	});
});
