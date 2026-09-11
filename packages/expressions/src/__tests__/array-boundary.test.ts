import { describe, expect, it, vi } from "vitest";
import { holeWithProperty, invalidArrayKeys } from "../../../../test/expression-array-fixtures.js";
import { namespace, ref } from "../../../../test/expression-fixtures.js";
import { copyJson, createExpressionService, validateExpression } from "../index.js";
import type { ExpressionBackend } from "../index.js";

const identity: ExpressionBackend = {
	id: "identity",
	compile: (expression) => ({
		ok: true,
		value: {
			evaluate: (read) =>
				expression.kind === "literal" ? expression.value : expression.kind === "ref" ? read(expression.ref) : null,
		},
	}),
};

describe("R1 dense canonical arrays at every JSON boundary", () => {
	it.each(invalidArrayKeys)("rejects a hole disguised by %s before invoking the backend", (key) => {
		const bad = holeWithProperty(key);
		const compile = vi.fn(identity.compile);
		const service = createExpressionService({ backend: { id: "spy", compile } });
		expect(() => copyJson(bad)).toThrow();
		expect(() => validateExpression({ kind: "literal", value: bad })).toThrow();
		expect(service.compile({ kind: "literal", value: bad }).ok).toBe(false);
		expect(compile).not.toHaveBeenCalled();
	});
	it.each(invalidArrayKeys)("rejects namespace reads and backend results containing %s", (key) => {
		const bad = holeWithProperty(key);
		const rootService = createExpressionService({ backend: identity, namespaces: { data: namespace(bad).provider } });
		const root = rootService.compile({ kind: "ref", ref: { namespace: "data", segments: [] } });
		if (!root.ok) throw new Error("compile");
		expect(rootService.evaluate(root.value).ok).toBe(false);
		const variants: ExpressionBackend[] = [
			identity,
			{ id: "bad-result", compile: () => ({ ok: true, value: { evaluate: () => bad } }) },
		];
		for (const backend of variants) {
			const service = createExpressionService({ backend, namespaces: { data: namespace({ x: bad }).provider } });
			const compiled = service.compile(backend === identity ? ref("x") : { kind: "literal", value: 1 });
			if (!compiled.ok) throw new Error("compile");
			expect(service.evaluate(compiled.value).ok).toBe(false);
		}
	});
	it("rejects extra/accessor/symbol indices without getters or oversized allocation", () => {
		const getter = vi.fn(() => 7);
		const accessor = Object.defineProperty(new Array(1), "0", { get: getter, enumerable: true });
		const symbol = Object.defineProperty([1], Symbol("index"), { value: 7 });
		const extra = Object.defineProperty([1], "01", { value: 7, enumerable: true });
		for (const bad of [accessor, symbol, extra, new Array(4294967295)]) expect(() => copyJson(bad)).toThrow();
		expect(getter).not.toHaveBeenCalled();
		expect(copyJson([])).toEqual([]);
		expect(copyJson([null, 0, [1, 2]])).toEqual([null, 0, [1, 2]]);
	});
});
