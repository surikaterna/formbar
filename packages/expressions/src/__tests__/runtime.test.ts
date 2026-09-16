import { describe, expect, it, vi } from "vitest";
import { literal, namespace, op, ref } from "../../../../test/expression-fixtures.js";
import { ExpressionProfile, createExpressionService, dependencyKey, failure, resolveRef } from "../index.js";
import type { Program } from "../index.js";
const compile = (service: ReturnType<typeof createExpressionService>, input: unknown): Program => {
	const result = service.compile(input);
	if (!result.ok) throw new Error(JSON.stringify(result));
	return result.value;
};

describe("neutral runtime and capabilities", () => {
	it("accepts an immutable custom Kuery profile and owns program identity", () => {
		const profile = new ExpressionProfile("host-profile", [
			{ name: "host:value", arity: 0, execute: () => "host-owned-op" },
		]);
		const service = createExpressionService({ profile });
		const program = compile(service, op("host:value"));
		expect(service.evaluate(program)).toEqual({ ok: true, value: "host-owned-op" });
		expect(createExpressionService({ profile }).evaluate(program)).toEqual(failure("unknown-program"));
		expect(Object.isFrozen(program.expression)).toBe(true);
	});
	it("resolves nested scopes, canonical numeric identity, and rejects cycles", () => {
		const scopes = {
			order: { namespace: "data", segments: ["orders", 1] },
			item: { namespace: "data", segments: ["items", 2], scope: "order" },
		};
		const resolved = resolveRef({ namespace: "data", segments: ["price"], scope: "item" }, scopes);
		expect(resolved.segments).toEqual(["orders", 1, "items", 2, "price"]);
		expect(dependencyKey({ namespace: "data", segments: [1] })).toBe(
			dependencyKey({ namespace: "data", segments: ["1"] }),
		);
		expect(() => resolveRef({ namespace: "ui", segments: [], scope: "item" }, scopes)).toThrow("invalid-input");
		expect(() =>
			resolveRef(
				{ namespace: "data", segments: [], scope: "x" },
				{ x: { namespace: "data", segments: [], scope: "x" } },
			),
		).toThrow("invalid-input");
	});
	it("reauthorizes reads and writes and clears prior values on revocation", () => {
		const state = namespace({ secret: "previous-secret" });
		let allowed = true;
		const service = createExpressionService({
			namespaces: { data: state.provider },
			authorize: () => allowed,
		});
		const program = compile(service, ref("secret"));
		const binding = service.resolveProps({ label: { mode: "write", expression: ref("secret") } });
		const stop = binding.subscribe(() => {});
		const setter = binding.getSnapshot().setters.label;
		expect(setter("ok").ok).toBe(true);
		allowed = false;
		service.invalidateAuthorization();
		expect(binding.getSnapshot().values.label).toBeUndefined();
		expect(service.evaluate(program)).toEqual(failure("denied"));
		expect(setter("no")).toEqual(failure("denied"));
		allowed = true;
		service.invalidateAuthorization();
		expect(setter("no")).toEqual(failure("stale"));
		expect(state.writes).toHaveLength(1);
		stop();
	});
	it("invalidates setters on parent/provider replacement, generation changes, and disposal", () => {
		const state = namespace({ x: 1 });
		const service = createExpressionService({ namespaces: { data: state.provider } });
		const program = compile(service, ref("x"));
		const setter = () => {
			const result = service.resolveWritable(program);
			if (!result.ok) throw new Error("setter");
			return result.value;
		};
		const parentSetter = setter();
		state.replace({ x: 1 });
		expect(parentSetter(2)).toEqual(failure("stale"));
		const versionSetter = setter();
		state.revoke();
		expect(versionSetter(2)).toEqual(failure("stale"));
		const replaced = setter();
		service.registerNamespace("data", namespace({ x: 1 }).provider);
		expect(replaced(2)).toEqual(failure("stale"));
		const disposed = setter();
		service.dispose();
		expect(disposed(2)).toEqual(failure("disposed"));
		expect(service.evaluate(program)).toEqual(failure("disposed"));
	});
	it("constructs lazy stable snapshots and releases subscriptions and retained setters", () => {
		const state = namespace({ x: 1 });
		const service = createExpressionService({ namespaces: { data: state.provider } });
		const binding = service.resolveProps({
			custom: { mode: "write", expression: ref("x") },
			label: { mode: "literal", value: "Text" },
		});
		const first = binding.getSnapshot();
		expect(binding.getSnapshot()).toBe(first);
		expect(state.listeners.size).toBe(0);
		expect(first.setters.custom(2)).toEqual(failure("stale"));
		const stop = binding.subscribe(() => {});
		expect(state.listeners.size).toBe(1);
		expect(first.setters.custom(2).ok).toBe(true);
		stop();
		expect(first.setters.custom(2)).toEqual(failure("stale"));
		const again = binding.subscribe(() => {});
		expect(binding.getSnapshot().setters.custom(3).ok).toBe(true);
		expect(first.setters.custom(3)).toEqual(failure("stale"));
		binding.dispose();
		expect(state.listeners.size).toBe(0);
		again();
	});
	it("removes namespace registrations and disposes live observers without leaking values", () => {
		const state = namespace({ x: "secret" });
		const service = createExpressionService({ namespaces: { external: state.provider } });
		const observed = service.observe(compile(service, ref("x", "external")));
		const listener = vi.fn();
		observed.getSnapshot();
		observed.subscribe(listener);
		service.registerNamespace("external");
		expect(observed.getSnapshot()).toEqual(failure("denied"));
		expect(state.listeners.size).toBe(0);
		service.dispose();
		expect(observed.getSnapshot()).toEqual(failure("disposed"));
		expect(listener).toHaveBeenCalledTimes(2);
	});
});

describe("bounded untrusted JSON", () => {
	it.each([
		undefined,
		() => 1,
		{ kind: "literal", value: Number.NaN },
		{ kind: "literal", value: Number.POSITIVE_INFINITY },
		{ kind: "literal", value: new Date() },
		{ kind: "literal", value: new Array(3) },
		{ kind: "literal", value: { run: () => 1 } },
		{ kind: "literal" },
		{ kind: "ref", ref: { namespace: "data", segments: ["__proto__"] } },
		{ kind: "ref", ref: { namespace: "data", segments: [-1] } },
		{ kind: "ref", ref: { namespace: "data", segments: ["constructor"] } },
		{ kind: "ref", ref: { namespace: "data", segments: ["prototype"] } },
		{ kind: "op", op: "x", args: [], engine: "evil" },
	])("rejects malformed input %#", (input) => {
		expect(createExpressionService({}).compile(input).ok).toBe(false);
	});
	it("rejects deep/cyclic/oversized input, symbols and accessors without invoking code", () => {
		const service = createExpressionService({});
		let deep = literal(1);
		for (let i = 0; i < 100; i++) deep = op("not", deep);
		const cyclic: unknown[] = [];
		cyclic.push(cyclic);
		const getter = vi.fn(() => "secret");
		const accessor = Object.defineProperty({}, "value", { get: getter, enumerable: true });
		for (const value of [
			deep,
			{ kind: "literal", value: cyclic },
			literal("x".repeat(16385)),
			literal(Array(1025).fill(1)),
			op("and", ...Array(33).fill(literal(true))),
			{ kind: "literal", value: accessor },
			{ kind: "literal", value: { [Symbol()]: 1 } },
		]) {
			expect(service.compile(value).ok).toBe(false);
		}
		expect(getter).not.toHaveBeenCalled();
	});
	it("does not traverse inherited properties or invoke state getters", () => {
		const getter = vi.fn(() => "secret");
		const root = Object.create({ inherited: "secret" });
		Object.defineProperty(root, "accessor", { get: getter });
		const service = createExpressionService({ namespaces: { data: namespace(root).provider } });
		expect(service.evaluate(compile(service, ref("inherited")))).toEqual(failure("missing"));
		expect(service.evaluate(compile(service, ref("accessor")))).toEqual(failure("denied"));
		expect(getter).not.toHaveBeenCalled();
	});
	it("sanitizes throwing and asynchronous custom operator failures", () => {
		for (const execute of [
			() => {
				throw new Error("secret");
			},
			async () => "secret",
		] as const) {
			const profile = new ExpressionProfile("unsafe-profile", [{ name: "host:unsafe", arity: 0, execute }]);
			const service = createExpressionService({ profile });
			const compiled = service.compile(op("host:unsafe"));
			if (!compiled.ok) throw new Error("compile");
			const result = service.evaluate(compiled.value);
			expect(result.ok).toBe(false);
			expect(JSON.stringify(result)).not.toContain("secret");
		}
	});
});
