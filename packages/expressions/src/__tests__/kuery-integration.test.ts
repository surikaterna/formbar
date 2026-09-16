import { describe, expect, it, vi } from "vitest";
import { expressionConformance } from "../../../../test/expression-conformance.js";
import { literal, namespace, op, ref } from "../../../../test/expression-fixtures.js";
import {
	ExpressionProfile,
	ExpressionProfileBuilder,
	createExpressionService,
	standardExpressionProfile,
} from "../index.js";

describe("Kuery whole-AST integration", () => {
	it("compiles a nested AST once and evaluates it through a custom profile", () => {
		const execute = vi.fn(([value]) => value);
		const lookups = vi.spyOn(ExpressionProfile.prototype, "get");
		const profile = new ExpressionProfile("app-v1", [{ name: "app:identity", arity: 1, execute }]);
		const service = createExpressionService({ profile });
		const compiled = service.compile(op("app:identity", op("app:identity", literal(7))));
		expect(compiled.ok).toBe(true);
		expect(lookups).toHaveBeenCalledTimes(2);
		if (!compiled.ok) return;
		expect(execute).not.toHaveBeenCalled();
		expect(service.evaluate(compiled.value)).toEqual({ ok: true, value: 7 });
		expect(execute).toHaveBeenCalledTimes(2);
		expect(service.evaluate(compiled.value)).toEqual({ ok: true, value: 7 });
		expect(execute).toHaveBeenCalledTimes(4);
		expect(lookups).toHaveBeenCalledTimes(2);
		lookups.mockRestore();
	});

	it("preauthorizes and reads dependencies in short-circuited branches", () => {
		const state = namespace({ allowed: false, secret: true });
		const authorize = vi.fn(
			(reference: { readonly segments: readonly (string | number)[] }) => reference.segments[0] !== "secret",
		);
		const service = createExpressionService({ namespaces: { data: state.provider }, authorize });
		const compiled = service.compile(op("and", ref("allowed"), ref("secret")));
		if (!compiled.ok) throw new Error("compile");
		expect(service.evaluate(compiled.value)).toEqual({ ok: false, diagnostics: [{ code: "denied" }] });
		expect(authorize).toHaveBeenCalledTimes(2);
	});

	it("passes direct and nested missing references to Kuery", () => {
		const service = createExpressionService({ namespaces: { data: namespace({ present: null }).provider } });
		const cases = [
			[ref("missing"), { ok: false, diagnostics: [{ code: "missing" }] }],
			[op("exists", ref("missing")), { ok: true, value: false }],
			[op("exists", op("add", ref("missing"), literal(1))), { ok: true, value: false }],
			[op("coalesce", ref("missing"), literal(7)), { ok: true, value: 7 }],
			[op("coalesce", op("add", ref("missing"), literal(1)), literal(8)), { ok: true, value: 8 }],
			[op("exists", ref("present")), { ok: true, value: true }],
			[ref("present"), { ok: true, value: null }],
		] as const;
		for (const [expression, expected] of cases) {
			const compiled = service.compile(expression);
			if (!compiled.ok) throw new Error("compile");
			expect(service.evaluate(compiled.value)).toEqual(expected);
		}
	});

	it("keeps missing short-circuited refs lazy after eager authorization and capture", () => {
		const snapshot = vi.fn(() => ({ gate: false }));
		const authorize = vi.fn(() => true);
		const service = createExpressionService({
			namespaces: { data: { getSnapshot: snapshot, subscribe: () => () => {} } },
			authorize,
		});
		const compiled = service.compile(op("and", ref("gate"), ref("missing")));
		if (!compiled.ok) throw new Error("compile");
		expect(service.evaluate(compiled.value)).toEqual({ ok: true, value: false });
		expect(authorize).toHaveBeenCalledTimes(2);
		expect(snapshot).toHaveBeenCalledTimes(1);
	});

	it("fails closed for a denied ref in a short-circuited branch", () => {
		const state = namespace({ gate: false, secret: true });
		const authorize = vi.fn(
			(reference: { readonly segments: readonly (string | number)[] }) => reference.segments[0] !== "secret",
		);
		const service = createExpressionService({ namespaces: { data: state.provider }, authorize });
		const compiled = service.compile(op("and", ref("gate"), ref("secret")));
		if (!compiled.ok) throw new Error("compile");
		expect(service.evaluate(compiled.value)).toEqual({ ok: false, diagnostics: [{ code: "denied" }] });
		expect(authorize).toHaveBeenCalledTimes(2);
	});

	it("uses lazy standard if after eagerly framing and authorizing both branches", () => {
		const state = namespace({ condition: true, selected: "yes" });
		const authorize = vi.fn(() => true);
		const service = createExpressionService({ namespaces: { data: state.provider }, authorize });
		const compiled = service.compile(op("if", ref("condition"), ref("selected"), ref("missing")));
		if (!compiled.ok) throw new Error("compile");
		expect(service.evaluate(compiled.value)).toEqual({ ok: true, value: "yes" });
		expect(authorize).toHaveBeenCalledTimes(3);
	});

	it("rejects a denied unselected if branch before selection", () => {
		const state = namespace({ condition: true, selected: "yes", secret: "no" });
		const authorize = vi.fn(
			(reference: { readonly segments: readonly (string | number)[] }) => reference.segments[0] !== "secret",
		);
		const service = createExpressionService({ namespaces: { data: state.provider }, authorize });
		const compiled = service.compile(op("if", ref("condition"), ref("selected"), ref("secret")));
		if (!compiled.ok) throw new Error("compile");
		expect(service.evaluate(compiled.value)).toEqual({ ok: false, diagnostics: [{ code: "denied" }] });
		expect(authorize).toHaveBeenCalledTimes(3);
	});

	it.each([undefined, null])("fails closed before snapshots and operators when authorization throws %s", (thrown) => {
		const snapshot = vi.fn(() => [7]);
		const execute = vi.fn(([left, right]) => (left as number) + (right as number));
		const profile = new ExpressionProfile("app-v1", [{ name: "app:add", arity: 2, execute }]);
		const authorize = vi.fn((reference: { readonly segments: readonly (string | number)[] }) => {
			if (typeof reference.segments[0] === "string") throw thrown;
			return true;
		});
		const service = createExpressionService({
			profile,
			namespaces: { data: { getSnapshot: snapshot, subscribe: () => () => {} } },
			authorize,
		});
		const numeric = { kind: "ref", ref: { namespace: "data", segments: [0] } } as const;
		const text = { kind: "ref", ref: { namespace: "data", segments: ["0"] } } as const;
		const compiled = service.compile(op("app:add", numeric, text));
		if (!compiled.ok) throw new Error("compile");
		const result = service.evaluate(compiled.value);
		expect(result).toEqual({ ok: false, diagnostics: [{ code: "adapter" }] });
		expect(JSON.stringify(result)).not.toContain(String(thrown));
		expect(authorize).toHaveBeenCalledTimes(2);
		expect(snapshot).not.toHaveBeenCalled();
		expect(execute).not.toHaveBeenCalled();
	});

	it("reacts when a dependency transitions between missing and present", () => {
		const state = namespace({});
		const service = createExpressionService({ namespaces: { data: state.provider } });
		const compiled = service.compile(op("coalesce", ref("optional"), literal("fallback")));
		if (!compiled.ok) throw new Error("compile");
		const observation = service.observe(compiled.value);
		const listener = vi.fn();
		const stop = observation.subscribe(listener);
		expect(observation.getSnapshot()).toEqual({ ok: true, value: "fallback" });
		state.replace({ optional: "present" });
		expect(observation.getSnapshot()).toEqual({ ok: true, value: "present" });
		state.replace({});
		expect(observation.getSnapshot()).toEqual({ ok: true, value: "fallback" });
		expect(listener).toHaveBeenCalledTimes(2);
		stop();
	});

	it("supports namespaced operators built with the public profile builder", () => {
		const profile = new ExpressionProfileBuilder("app-v1")
			.add({
				name: "app:double",
				arity: 1,
				inputTypes: ["number"],
				resultType: "number",
				execute: ([value]) => (value as number) * 2,
			})
			.build();
		const service = createExpressionService({ profile });
		const compiled = service.compile(op("app:double", literal(6)));
		expect(compiled.ok && service.evaluate(compiled.value)).toEqual({ ok: true, value: 12 });
	});

	it("maps Kuery diagnostics to stable code-only Formbar diagnostics", () => {
		const service = createExpressionService({});
		const cases = [
			[op("add", literal(1)), "arity"],
			[op("div", literal(1), literal(0)), "division-zero"],
			[op("mul", literal(Number.MAX_VALUE), literal(2)), "non-finite"],
			[op("add", literal("secret"), literal(1)), "type"],
		] as const;
		for (const [expression, code] of cases) {
			const compiled = service.compile(expression);
			const result = compiled.ok ? service.evaluate(compiled.value) : compiled;
			expect(result).toEqual({ ok: false, diagnostics: [{ code }] });
			expect(JSON.stringify(result)).not.toContain("secret");
		}
	});

	it("uses strict standard semantics for nested operators and JSON equality", () => {
		const service = createExpressionService({});
		const nested = op(
			"add",
			op("mul", literal(2), literal(10)),
			op("div", op("sub", literal(12), literal(2)), literal(2)),
		);
		const equality = op("eq", literal({ a: [1] }), literal({ a: [1] }));
		for (const [expression, expected] of [
			[nested, 25],
			[equality, true],
		] as const) {
			const compiled = service.compile(expression);
			expect(compiled.ok && service.evaluate(compiled.value)).toEqual({ ok: true, value: expected });
		}
	});

	it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "secret-number", null, true])(
		"rejects invalid dynamic arithmetic operand %s without leaking it",
		(value) => {
			const service = createExpressionService({ namespaces: { data: namespace({ x: value }).provider } });
			const compiled = service.compile(op("add", ref("x"), literal(1)));
			if (!compiled.ok) throw new Error("compile");
			const result = service.evaluate(compiled.value);
			expect(result.ok).toBe(false);
			expect(JSON.stringify(result)).not.toContain("secret-number");
		},
	);
});

expressionConformance("Kuery standard-v1 through Formbar");
expressionConformance("explicit Kuery standard-v1 profile", () =>
	createExpressionService({ profile: standardExpressionProfile }),
);
