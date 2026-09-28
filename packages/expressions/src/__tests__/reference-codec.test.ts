import { describe, expect, it, vi } from "vitest";
import { ExpressionError, LIMITS, type StateRef, parseRef, resolveRef } from "../index.js";

describe("public reference codec", () => {
	it("preserves scoped and unscoped segment identity without resolving row placeholders", () => {
		for (const scope of [undefined, "row"]) {
			const source = { namespace: "data", segments: ["0", 0, "field"], ...(scope ? { scope } : {}) };
			const parsed: StateRef = parseRef(source);
			expect(parsed).toEqual(source);
			expect(parsed.segments).toEqual(["0", 0, "field"]);
			expect(Object.keys(parsed)).toEqual(scope ? ["namespace", "segments", "scope"] : ["namespace", "segments"]);
			expect(Object.isFrozen(parsed)).toBe(true);
			expect(Object.isFrozen(parsed.segments)).toBe(true);
			source.segments.push("later");
			expect(parsed.segments).toEqual(["0", 0, "field"]);
		}
		const scoped = parseRef({ namespace: "data", segments: ["0", 0], scope: "row" });
		expect(resolveRef(scoped, { row: { namespace: "data", segments: ["rows", 2] } }).segments).toEqual([
			"rows",
			2,
			"0",
			0,
		]);
		expect(scoped.scope).toBe("row");
	});

	it("rejects malformed, unsafe and oversized references with code-only errors", () => {
		for (const input of [
			null,
			{ namespace: "data" },
			{ namespace: "data", segments: [], extra: 1 },
			{ namespace: "__proto__", segments: [] },
			{ namespace: "data", segments: [], scope: "constructor" },
			{ namespace: "data", segments: ["prototype"] },
			{ namespace: "data", segments: [-1] },
			{ namespace: "data", segments: [1.5] },
			{ namespace: "data", segments: [Number.MAX_SAFE_INTEGER + 1] },
			{ namespace: "data", segments: Array(LIMITS.segments + 1).fill("x") },
		]) {
			expect(() => parseRef(input)).toThrow(ExpressionError);
		}
		expect(() => parseRef({ namespace: "data", segments: Array(LIMITS.segments + 1).fill("x") })).toThrow(/^limit$/);
	});

	it("never invokes getters and rejects cyclic, sparse or non-JSON input", () => {
		const getter = vi.fn(() => "data");
		const accessor = { segments: [] } as Record<string, unknown>;
		Object.defineProperty(accessor, "namespace", { enumerable: true, get: getter });
		const cyclic: { namespace: string; segments: unknown[] } = { namespace: "data", segments: [] };
		cyclic.segments.push(cyclic);
		for (const input of [accessor, cyclic, { namespace: "data", segments: Array(1) }, new Date()]) {
			expect(() => parseRef(input)).toThrow(ExpressionError);
		}
		expect(getter).not.toHaveBeenCalled();
	});
});
