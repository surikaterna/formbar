import { createExpressionService } from "@formbar/expressions";
import type { ExpressionService } from "@formbar/expressions";
import { describe, expect, it } from "vitest";
import { literal, namespace, op, ref } from "./expression-fixtures.js";

/** Shared fixtures for Formbar's Kuery standard-profile integration. */
export function expressionConformance(
	name: string,
	createService = (): ExpressionService => createExpressionService({}),
): void {
	describe(name, () => {
		it.each([
			["add", 7, 3, 10],
			["sub", 7, 3, 4],
			["mul", 7, 3, 21],
			["div", 7, 2, 3.5],
			["eq", 3, 3, true],
			["neq", 3, 4, true],
			["gt", 4, 3, true],
			["gte", 3, 3, true],
			["lt", 3, 4, true],
			["lte", 3, 3, true],
			["and", true, false, false],
			["or", true, false, true],
		] as const)("evaluates %s", (operator, a, b, expected) => {
			const service = createService();
			const compiled = service.compile(op(operator, literal(a), literal(b)));
			expect(compiled.ok).toBe(true);
			if (compiled.ok) expect(service.evaluate(compiled.value)).toEqual({ ok: true, value: expected });
		});
		it("tracks canonical dependencies and only notifies changed projections", () => {
			const state = namespace({ a: 2, b: 3, other: 1 });
			const service = createService();
			service.registerNamespace("data", state.provider);
			const compiled = service.compile(op("add", ref("b"), op("mul", ref("a"), ref("a"))));
			if (!compiled.ok) throw new Error("compile");
			expect(compiled.value.dependencies.map((r) => r.segments)).toEqual([["a"], ["b"]]);
			const observed = service.observe(compiled.value);
			const first = observed.getSnapshot();
			let calls = 0;
			const stop = observed.subscribe(() => calls++);
			state.replace({ a: 2, b: 3, other: 2 });
			expect(calls).toBe(0);
			expect(observed.getSnapshot()).toBe(first);
			state.replace({ a: 4, b: 3 });
			expect(observed.getSnapshot()).toEqual({ ok: true, value: 19 });
			expect(calls).toBe(1);
			stop();
			expect(state.listeners.size).toBe(0);
		});
		it("denies absent capabilities and separates missing from null", () => {
			const service = createService();
			service.registerNamespace("data", namespace({ a: null }).provider);
			for (const [expression, code] of [
				[ref("a"), null],
				[ref("b"), "missing"],
				[ref("a", "secret"), "denied"],
			] as const) {
				const compiled = service.compile(expression);
				if (!compiled.ok) throw new Error("compile");
				expect(service.evaluate(compiled.value)).toEqual(
					code ? { ok: false, diagnostics: [{ code }] } : { ok: true, value: null },
				);
			}
		});
		it.each(["constructor", "random", "eval", "$where"])("rejects unsupported %s", (name) => {
			const service = createService();
			expect(service.compile(op(name, literal(1))).ok).toBe(false);
		});
	});
}
