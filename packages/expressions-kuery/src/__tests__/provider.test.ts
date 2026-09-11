import { createExpressionService } from "@formbar/expressions";
import { describe, expect, it } from "vitest";
import { providerConformance } from "../../../../test/expression-conformance.js";
import { literal, namespace, op, ref } from "../../../../test/expression-fixtures.js";
import { createKueryBackend } from "../index.js";

providerConformance("Kuery strict finite v1", createKueryBackend);
providerConformance("injected host backend wrapper", () => {
	const backend = createKueryBackend();
	return { id: "host-plugin", compile: (expression) => backend.compile(expression) };
});

describe("strict arithmetic and public predicates", () => {
	it("validates known nested operator result types during compilation", () => {
		const service = createExpressionService({ backend: createKueryBackend() });
		expect(service.compile(op("add", op("eq", ref("x"), literal(1)), literal(2)))).toEqual({
			ok: false,
			diagnostics: [{ code: "type" }],
		});
	});
	it.each([
		[op("not", literal(false)), true],
		[op("in", literal("x"), literal(["x", "y"])), true],
		[op("nin", literal("x"), literal(["y"])), true],
		[op("eq", literal({ a: 1 }), literal({ a: 1 })), false],
		[
			op(
				"add",
				op("multiply", literal(2), literal(10)),
				op("divide", op("subtract", literal(12), literal(2)), literal(2)),
			),
			25,
		],
	] as const)("supports %j", (expression, value) => {
		const service = createExpressionService({ backend: createKueryBackend() });
		const compiled = service.compile(expression);
		if (!compiled.ok) throw new Error(JSON.stringify(compiled));
		expect(service.evaluate(compiled.value)).toEqual({ ok: true, value });
		expect(service.resolveWritable(compiled.value)).toEqual({ ok: false, diagnostics: [{ code: "read-only" }] });
	});
	it.each([
		["add", [literal(1)], "arity"],
		["multiply", [literal(1), literal(2), literal(3)], "arity"],
		["divide", [literal(1), literal(0)], "division-zero"],
		["divide", [literal(1), literal(-0)], "division-zero"],
		["multiply", [literal(Number.MAX_VALUE), literal(2)], "non-finite"],
		["add", [literal("2"), literal(1)], "type"],
		["subtract", [literal(null), literal(1)], "type"],
		["divide", [literal(true), literal(1)], "type"],
		["and", [literal(1)], "type"],
		["gt", [literal("1"), literal(1)], "type"],
		["in", [literal(1), literal("1")], "type"],
	] as const)("rejects %s invalid operands %j", (name, args, code) => {
		const service = createExpressionService({ backend: createKueryBackend() });
		const compiled = service.compile(op(name, ...args));
		const result = compiled.ok ? service.evaluate(compiled.value) : compiled;
		expect(result).toEqual({ ok: false, diagnostics: [{ code }] });
	});
	it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "secret-number", null, true])(
		"validates dynamic operand %s",
		(value) => {
			const service = createExpressionService({
				backend: createKueryBackend(),
				namespaces: { data: namespace({ x: value }).provider },
			});
			const compiled = service.compile(op("add", ref("x"), literal(1)));
			if (!compiled.ok) throw new Error("compile");
			const result = service.evaluate(compiled.value);
			expect(result.ok).toBe(false);
			expect(JSON.stringify(result)).not.toContain("secret-number");
		},
	);
});
