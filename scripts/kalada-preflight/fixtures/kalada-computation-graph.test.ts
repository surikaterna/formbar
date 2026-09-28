import { describe, expect, it, vi } from "vitest";
import { admitKaladaDefinition } from "../../../packages/declarative/src/validators/kalada-definition.js";

type Segment = string | number;
const binding = (segments: Segment[], namespace = "data", scope?: string) => ({
	namespace,
	segments,
	...(scope ? { scope } : {}),
});
const program = (expression: unknown) => ({ format: "kalada-program", version: 1, profile: "kalada-v1", expression });
const read = (segments: Segment[], namespace = "data", scope?: string) =>
	program({ kind: "ref", ref: binding(segments, namespace, scope) });
const literal = program({ kind: "literal", value: 1 });
const computation = (id: string, target: ReturnType<typeof binding>, expression: unknown = literal) => ({
	id,
	target,
	expression,
});
const definition = (computations: unknown[], visible: unknown = literal) => ({
	version: 1,
	id: "form",
	root: { type: "group", id: "root", visible, children: [] },
	computations,
});

describe("private Kalada computation graph", () => {
	it("associates ordered compiled expressions and typed target identities without evaluating", () => {
		const execute = vi.fn();
		const entries = [
			computation("zero", binding([0]), read(["external"])),
			computation(
				"text",
				binding(["0"]),
				program({
					kind: "boolean-logical",
					operator: "and",
					left: { kind: "ref", ref: binding([0]) },
					right: { kind: "ref", ref: binding([0]) },
				}),
			),
			computation("unused", binding(["unused"])),
		];
		const admitted = admitKaladaDefinition(definition(entries, read(["unused"])));
		expect(admitted.slots[0]?.path).toBe("root.visible");
		expect(
			admitted.computations.map(({ id, path, target, expression }) => ({ id, path, target, slot: expression.path })),
		).toEqual([
			{
				id: "zero",
				path: "computations[0]",
				target: { namespace: "data", path: [0] },
				slot: "computations[0].expression",
			},
			{
				id: "text",
				path: "computations[1]",
				target: { namespace: "data", path: ["0"] },
				slot: "computations[1].expression",
			},
			{
				id: "unused",
				path: "computations[2]",
				target: { namespace: "data", path: ["unused"] },
				slot: "computations[2].expression",
			},
		]);
		expect(admitted.computations[1]?.expression).toBe(admitted.slots[2]);
		expect(admitted.computations[1]?.expression.dependencies).toEqual([{ namespace: "data", path: [0] }]);
		expect(execute).not.toHaveBeenCalled();
	});

	it.each([
		["ui", binding(["x"], "ui")],
		["scoped", binding(["x"], "data", "rows")],
		["empty", binding([])],
		["form", binding(["valid"], "form")],
	])("rejects %s computation targets at their own path", (_name, target) => {
		expect(() => admitKaladaDefinition(definition([computation("a", target)]))).toThrow(
			"computations[0].target: INVALID_BINDING",
		);
	});

	it("rejects duplicate IDs and normalized targets at the second declaration", () => {
		expect(() =>
			admitKaladaDefinition(definition([computation("same", binding(["a"])), computation("same", binding(["b"]))])),
		).toThrow("computations[1].id: DUPLICATE_COMPUTATION_ID");
		expect(() =>
			admitKaladaDefinition(definition([computation("a", binding([0])), computation("b", binding([0]))])),
		).toThrow("computations[1].target: DUPLICATE_COMPUTATION_TARGET");
	});

	it("rejects self reads, including lazy reads, at the expression slot", () => {
		expect(() => admitKaladaDefinition(definition([computation("a", binding(["a"]), read(["a"]))]))).toThrow(
			"computations[0].expression: SELF_DEPENDENCY",
		);
	});

	it("finds the earliest participating expression in a multi-node cycle, not a downstream reader", () => {
		const entries = [
			computation("downstream", binding(["d"]), read(["a"])),
			computation("a", binding(["a"]), read(["b"])),
			computation(
				"b",
				binding(["b"]),
				program({
					kind: "boolean-logical",
					operator: "or",
					left: { kind: "literal", value: true },
					right: { kind: "ref", ref: binding(["c"]) },
				}),
			),
			computation("c", binding(["c"]), read(["a"])),
		];
		expect(() => admitKaladaDefinition(definition(entries))).toThrow("computations[1].expression: COMPUTATION_CYCLE");
	});
});
