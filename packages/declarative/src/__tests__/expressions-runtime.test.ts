import { describe, expect, it } from "vitest";
import type { Expression, FormNode } from "../index.js";
import { dataRef, definition, field, literal, node, op, runtime } from "./runtime-fixtures.js";

const operatorCases: readonly [string, Expression, boolean][] = [
	["add", op("eq", op("add", literal(7), literal(3)), literal(10)), true],
	["sub", op("eq", op("sub", literal(7), literal(3)), literal(4)), true],
	["mul", op("eq", op("mul", literal(7), literal(3)), literal(21)), true],
	["div", op("eq", op("div", literal(7), literal(2)), literal(3.5)), true],
	["eq", op("eq", literal(3), literal(3)), true],
	["neq", op("neq", literal(3), literal(4)), true],
	["gt", op("gt", literal(4), literal(3)), true],
	["gte", op("gte", literal(3), literal(3)), true],
	["lt", op("lt", literal(3), literal(4)), true],
	["lte", op("lte", literal(3), literal(3)), true],
	["and", op("and", literal(true), literal(true)), true],
	["or", op("or", literal(false), literal(true)), true],
	["not", op("not", literal(false)), true],
	["if", op("if", literal(true), literal(true), literal(false)), true],
	["coalesce", op("coalesce", dataRef(["missing"]), literal(true)), true],
	["exists", op("exists", dataRef(["present"])), true],
];

describe("expression runtime integration", () => {
	it.each(operatorCases)("evaluates public standard-v1 %s through the expression service", (_name, expression, expected) => {
		const formDefinition = definition([field("value", ["present"], { visible: expression })]);
		const { runtime: port } = runtime(formDefinition, { initialData: { present: 1 } });
		expect(node(port, "value")?.visible).toBe(expected);
	});

	it("applies the conservative failure matrix with contextual diagnostics", () => {
		const conditional: FormNode = {
			type: "conditional",
			id: "choice",
			condition: dataRef(["missing"]),
			// biome-ignore lint/suspicious/noThenProperty: Serialized conditional branch fixture.
			then: [field("yes", ["yes"])],
			else: [field("no", ["no"])],
		};
		const formDefinition = definition([
			field("closed", ["closed"], {
				visible: dataRef(["missing"]),
				disabled: { kind: "ref", ref: { namespace: "secret", segments: ["missing"] } },
				readOnly: literal("bad" as never),
				required: dataRef(["missing"]),
			}),
			conditional,
		]);
		const { runtime: port } = runtime(formDefinition, { initialData: { closed: "x", yes: 1, no: 2 } });
		const closed = port.getSnapshot().fields.find((item) => item.instance.nodeId === "closed");
		expect(closed).toMatchObject({ visible: false, disabled: true, readOnly: true, required: true });
		expect(node(port, "choice")?.branch).toBe("none");
		expect(node(port, "yes")?.visible).toBe(false);
		expect(node(port, "no")?.visible).toBe(false);
		expect(port.getSnapshot().diagnostics.map((item) => [item.nodeId, item.property, item.expressionCode])).toEqual([
			["choice", "condition", "missing"],
			["closed", "disabled", "denied"],
			["closed", "readOnly", "type"],
			["closed", "required", "missing"],
			["closed", "visible", "missing"],
		]);
	});
});
