import { describe, expect, it, vi } from "vitest";
import { createExpressionService, validateExpression } from "../index.js";
import type { PropDefinitions, Scopes } from "../index.js";

describe("Y1 parses JSON shapes before constructing typed contracts", () => {
	it.each([
		null,
		[],
		1,
		true,
		"literal",
		{},
		{ kind: "literal" },
		{ kind: "ref", ref: [] },
		{ kind: "ref", ref: null },
		{ kind: "ref", ref: { namespace: "data", segments: "x" } },
		{ kind: "ref", ref: { namespace: "data", segments: [], scope: null } },
		{ kind: "op", op: "add", args: {} },
		{ kind: "op", op: "add", args: [null] },
	])("rejects malformed expression %#", (input) => {
		expect(() => validateExpression(input)).toThrow();
	});
	it.each([
		null,
		[],
		1,
		{ value: null },
		{ value: [] },
		{ value: { mode: "literal" } },
		{ value: { mode: "read" } },
		{ value: { mode: "unknown", expression: {} } },
		{ value: { mode: "write", expression: null } },
	])("rejects malformed prop map/spec %#", (input) => {
		const service = createExpressionService({});
		const snapshot = service.resolveProps(input as PropDefinitions).getSnapshot();
		expect(Object.keys(snapshot.setters)).toEqual([]);
		expect(Object.values(snapshot.values).every((value) => value === undefined)).toBe(true);
		expect(Object.keys(snapshot.diagnostics).length).toBeGreaterThan(0);
	});
	it.each([
		null,
		[],
		1,
		{ item: null },
		{ item: [] },
		{ item: { namespace: "data" } },
		{ item: { namespace: 1, segments: [] } },
		{ item: { namespace: "data", segments: [null] } },
		{ item: { namespace: "data", segments: [], extra: true } },
	])("rejects malformed scopes %# during service construction", (input) => {
		expect(() => createExpressionService({ scopes: input as Scopes })).toThrow();
	});
	it("never invokes shape accessors and constructs frozen canonical refs", () => {
		const getter = vi.fn(() => "data");
		const invalid = {
			kind: "ref",
			ref: Object.defineProperty({ segments: [] }, "namespace", { get: getter, enumerable: true }),
		};
		expect(() => validateExpression(invalid)).toThrow();
		expect(getter).not.toHaveBeenCalled();
		const node = validateExpression({ kind: "ref", ref: { namespace: "data", segments: ["items", 0] } });
		expect(Object.isFrozen(node)).toBe(true);
		if (node.kind === "ref") expect(Object.isFrozen(node.ref.segments)).toBe(true);
	});
});
