import { createSession } from "@arbitre/core";
import type { ThenOperatorHandler, ThenOperatorRegistry } from "@arbitre/core";
import { ExpressionError } from "@formbar/expressions";
import { describe, expect, it, vi } from "vitest";
import { literal, op, ref } from "../../../../test/expression-fixtures.js";
import { FORMBAR_VALUE_THEN_OPERATOR, registerExpressionThenOperator } from "../index.js";

function createRegistry(): ThenOperatorRegistry {
	const handlers = new Map<string, ThenOperatorHandler>();
	return {
		register(name, handler) {
			if (handlers.has(name)) throw new Error("duplicate");
			handlers.set(name, handler);
		},
		get: (name) => handlers.get(name),
		has: (name) => handlers.has(name),
	};
}

function programMap(entries: Record<string, ReturnType<typeof literal> | ReturnType<typeof ref>>) {
	return new Map(Object.entries(entries));
}

describe("Arbitre expression then operator", () => {
	it("registers the fixed public name and rejects duplicate registration", () => {
		const registry = createRegistry();
		const registered = registerExpressionThenOperator(registry, { programs: programMap({ value: literal(1) }) });
		expect(registry.get(FORMBAR_VALUE_THEN_OPERATOR)).toBe(registered.handler);
		expect(() => registerExpressionThenOperator(registry, { programs: new Map() })).toThrow(/^invalid-input$/);
		registered.dispose();
	});

	it("compiles every program before mutating the registry and cleans up registration failures", () => {
		const registry = createRegistry();
		const register = vi.spyOn(registry, "register");
		expect(() =>
			registerExpressionThenOperator(registry, {
				programs: new Map([
					["ok", literal(1)],
					["bad", { kind: "op", op: "missing", args: [] }],
				]),
			}),
		).toThrow(/^unsupported-operator$/);
		expect(register).not.toHaveBeenCalled();
		const failing = {
			...createRegistry(),
			register: () => {
				throw new Error("secret");
			},
		};
		expect(() => registerExpressionThenOperator(failing, { programs: new Map() })).toThrow(/^adapter$/);
	});

	it("uses one incoming scope for atomic ordered writes while separate stages chain", () => {
		const registry = createRegistry();
		registerExpressionThenOperator(registry, {
			programs: new Map([
				["source", ref("source")],
				["first", ref("first")],
			]),
		});
		const session = createSession({
			initialState: { trigger: true, source: 2, first: 10 },
			thenOperators: registry,
			rules: [
				{
					name: "pipeline",
					when: { trigger: true },
					then: [
						{ $set: { source: 3 } },
						{ $formbarValue: { first: "source", sameStage: "first" } },
						{ $formbarValue: { nextStage: "first" } },
					],
				},
			],
		});
		const result = session.fire();
		expect(session.getState()).toMatchObject({ source: 3, first: 3, sameStage: 10, nextStage: 3 });
		expect(result.changes.map(({ path }) => path)).toEqual(["source", "first", "sameStage", "nextStage"]);
		expect(session.introspect.getRuleDependencies("pipeline")).toMatchObject({
			actionWrites: ["source"],
			actionWritesUnknown: true,
			rhsReads: [],
		});
	});

	it("evaluates all entries before writing and records no partial changes on failure", () => {
		const registry = createRegistry();
		registerExpressionThenOperator(registry, {
			programs: programMap({ ok: literal(1), denied: ref("secret") }),
			authorize: (reference) => reference.segments[0] !== "secret",
		});
		const session = createSession({
			initialState: { trigger: true, secret: 9 },
			thenOperators: registry,
			rules: [
				{ name: "atomic", when: { trigger: true }, then: [{ $formbarValue: { first: "ok", second: "denied" } }] },
			],
		});
		expect(() => session.fire()).toThrow(/^denied$/);
		expect(session.getPath("first")).toBeUndefined();
	});

	it("selects plain synchronous namespaces and maps selector failures to adapter", async () => {
		const registry = createRegistry();
		let selection: unknown = { pricing: { rate: 5 } };
		const registered = registerExpressionThenOperator(registry, {
			programs: new Map([["total", op("add", ref("source"), ref("rate", "pricing"))]]),
			namespaces: () => selection as Record<string, unknown>,
		});
		const run = () => registered.handler(new Map([["total", "total"]]), { source: 2 }, () => {});
		expect(run).not.toThrow();
		selection = null;
		expect(run).toThrow(/^adapter$/);
		selection = Promise.reject(new Error("secret"));
		expect(run).toThrow(/^adapter$/);
		await new Promise((resolve) => setTimeout(resolve, 0));
		selection = Object.create({ inherited: true });
		expect(run).toThrow(/^adapter$/);
	});

	it("rejects malformed IDs, unknown programs, and use after idempotent disposal", () => {
		const registry = createRegistry();
		const registered = registerExpressionThenOperator(registry, { programs: programMap({ value: literal(1) }) });
		expect(() => registered.handler(new Map([["x", 1]]), {}, () => {})).toThrow(/^invalid-input$/);
		expect(() => registered.handler(new Map([["x", "unknown"]]), {}, () => {})).toThrow(/^unknown-program$/);
		registered.dispose();
		registered.dispose();
		expect(() => registered.handler(new Map([["x", "value"]]), {}, () => {})).toThrow(/^disposed$/);
		expect(() => {
			throw new ExpressionError("adapter");
		}).toThrow(/^adapter$/);
	});

	it("participates in Arbitre truth maintenance through tracked writes", () => {
		const registry = createRegistry();
		registerExpressionThenOperator(registry, { programs: programMap({ value: literal(7) }) });
		const session = createSession({
			initialState: { active: false },
			thenOperators: registry,
			rules: [{ name: "derived", when: { active: true }, then: [{ $formbarValue: { derived: "value" } }] }],
		});
		session.assert("active", true);
		expect(session.fire().changes.some(({ path }) => path === "derived")).toBe(true);
		session.assert("active", false);
		expect(session.fire().changes.some(({ path, newValue }) => path === "derived" && newValue === undefined)).toBe(
			true,
		);
	});
});
