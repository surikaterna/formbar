import { describe, expect, it, vi } from "vitest";
import { literal, namespace, op, ref } from "../../../../test/expression-fixtures.js";
import { createExpressionService, failure, forwardExpressionProp } from "../index.js";
import type { ExpressionBackend, JsonValue, PropDefinitions } from "../index.js";

const identity: ExpressionBackend = {
	id: "identity",
	compile: (node) => ({
		ok: true,
		value: { evaluate: (read) => (node.kind === "ref" ? read(node.ref) : node.kind === "literal" ? node.value : null) },
	}),
};

describe("expression boundary hardening", () => {
	it("clears prior mounted values if provider replacement cannot subscribe, then recovers", () => {
		const state = namespace({ x: "secret" });
		const service = createExpressionService({ backend: identity, namespaces: { data: state.provider } });
		const binding = service.resolveProps({ value: { mode: "read", expression: ref("x") } });
		const listener = vi.fn();
		binding.subscribe(listener);
		expect(binding.getSnapshot().values.value).toBe("secret");
		expect(() =>
			service.registerNamespace("data", {
				...state.provider,
				subscribe() {
					throw new Error("secret");
				},
			}),
		).toThrow(/^adapter$/);
		expect(binding.getSnapshot().values.value).toBeUndefined();
		expect(listener).toHaveBeenCalledTimes(1);
		expect(state.listeners.size).toBe(0);
		service.registerNamespace("data", state.provider);
		expect(binding.getSnapshot().values.value).toBe("secret");
		binding.dispose();
		service.dispose();
	});
	it("keeps read authorization separate from write authorization and rejects async writes", async () => {
		const state = namespace({ x: 1 });
		const service = createExpressionService({
			backend: identity,
			namespaces: { data: state.provider },
			authorize: (_, operation) => operation === "read",
		});
		const compiled = service.compile(ref("x"));
		if (!compiled.ok) throw new Error("compile");
		expect(service.evaluate(compiled.value)).toEqual({ ok: true, value: 1 });
		expect(service.resolveWritable(compiled.value)).toEqual(failure("denied"));
		expect(state.writes).toHaveLength(0);
		const asyncProvider = {
			...state.provider,
			write: async () => {
				throw new Error("secret");
			},
		} as unknown as typeof state.provider;
		const asyncService = createExpressionService({ backend: identity, namespaces: { data: asyncProvider } });
		const asyncProgram = asyncService.compile(ref("x"));
		if (!asyncProgram.ok) throw new Error("compile");
		const writable = asyncService.resolveWritable(asyncProgram.value);
		if (!writable.ok) throw new Error("resolve");
		expect(writable.value(2)).toEqual(failure("adapter"));
		await Promise.resolve();
	});
	it("reads a stable root once for multiple dependencies and shares repeated authorized reads", () => {
		const snapshot = vi.fn().mockReturnValueOnce({ a: 1, b: 2 }).mockReturnValue({ a: 10, b: 20 });
		const backend: ExpressionBackend = {
			id: "sum",
			compile: () => ({
				ok: true,
				value: { evaluate: (read) => [read(ref("a").ref), read(ref("a").ref), read(ref("b").ref)] },
			}),
		};
		const service = createExpressionService({
			backend,
			namespaces: { data: { getSnapshot: snapshot, subscribe: () => () => {} } },
		});
		const compiled = service.compile(op("sum", ref("a"), ref("b")));
		if (!compiled.ok) throw new Error("compile");
		expect(service.evaluate(compiled.value)).toEqual({ ok: true, value: [1, 1, 2] });
		expect(snapshot).toHaveBeenCalledTimes(1);
	});
	it("bounds bad paths, literal object keys and readonly derived prop contracts", () => {
		const service = createExpressionService({ backend: identity });
		for (const segments of [Array(65).fill("x"), [1.5], [Number.MAX_SAFE_INTEGER + 1], [""], [Symbol()]]) {
			expect(service.compile({ kind: "ref", ref: { namespace: "data", segments } }).ok).toBe(false);
		}
		expect(service.compile(literal({ ["x".repeat(16385)]: 1 })).ok).toBe(false);
		const invalid = {
			value: { mode: "write", expression: op("add", literal(1), literal(2)) },
		} as unknown as PropDefinitions;
		const binding = service.resolveProps(invalid);
		expect(binding.getSnapshot().setters.value).toBeUndefined();
		expect(binding.getSnapshot().diagnostics.value).toEqual([{ code: "read-only" }]);
	});
	it("returns deterministic code-only errors from async compile/evaluate and backend diagnostics", async () => {
		const variants = [
			{
				id: "compile",
				compile: async () => {
					throw new Error("secret");
				},
			},
			{
				id: "evaluate",
				compile: () => ({
					ok: true,
					value: {
						evaluate: async () => {
							throw new Error("secret");
						},
					},
				}),
			},
			{ id: "diagnostic", compile: () => ({ ok: false, diagnostics: [{ code: "secret", message: "secret" }] }) },
		] as unknown as ExpressionBackend[];
		for (const backend of variants) {
			const service = createExpressionService({ backend });
			const compiled = service.compile(literal(1));
			expect(compiled.ok ? service.evaluate(compiled.value) : compiled).toEqual(failure("backend"));
		}
		await Promise.resolve();
	});
	it("does not retain a half-connected subscription after adapter failure", () => {
		const state = namespace({ x: 1 });
		const service = createExpressionService({
			backend: identity,
			namespaces: {
				data: state.provider,
				broken: {
					getSnapshot: () => ({}),
					subscribe() {
						throw new Error("secret");
					},
				},
			},
		});
		const binding = service.resolveProps({ value: { mode: "read", expression: ref("x") } });
		expect(() => binding.subscribe(() => {})).toThrow(/^adapter$/);
		expect(state.listeners.size).toBe(0);
		service.registerNamespace("broken");
		const stop = binding.subscribe(() => {});
		expect(state.listeners.size).toBe(1);
		stop();
		expect(state.listeners.size).toBe(0);
	});
	it("forwards typed ordinary props only after the host's guard, preserving readonly semantics", () => {
		const service = createExpressionService({ backend: identity });
		const binding = service.resolveProps({
			min: { mode: "literal", value: 2 },
			custom: { mode: "literal", value: "label" },
		});
		const number = (value: JsonValue): value is number => typeof value === "number";
		expect(forwardExpressionProp(binding.getSnapshot(), "min", number)).toEqual({ ok: true, value: { value: 2 } });
		expect(forwardExpressionProp(binding.getSnapshot(), "custom", number)).toEqual(failure("type"));
		binding.dispose();
		expect(forwardExpressionProp(binding.getSnapshot(), "min", number)).toEqual(failure("disposed"));
	});
	it("clones and freezes literals rather than accepting mutations after compilation", () => {
		const source = { x: [1, 2] };
		const service = createExpressionService({ backend: identity });
		const compiled = service.compile(literal(source));
		if (!compiled.ok) throw new Error("compile");
		source.x.push(3);
		const result = service.evaluate(compiled.value);
		expect(result).toEqual({ ok: true, value: { x: [1, 2] } });
		if (result.ok) expect(Object.isFrozen(result.value)).toBe(true);
	});
});
