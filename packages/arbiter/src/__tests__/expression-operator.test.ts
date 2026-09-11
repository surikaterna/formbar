import { createSession } from "@arbitre/core";
import { createCoreExpressionNamespaces, createForm } from "@formbar/core";
import { createExpressionService } from "@formbar/expressions";
import { createKueryBackend } from "@formbar/expressions-kuery";
import { describe, expect, it } from "vitest";
import { literal, op, ref } from "../../../../test/expression-fixtures.js";
import { createArbiterPlugin, createExpressionOperator } from "../index.js";

describe("public opt-in Arbitre expression operator", () => {
	it("consumes rejected async namespace selectors without exposing errors or adding async support", async () => {
		const errors: unknown[] = [];
		const listener = (reason: unknown) => {
			errors.push(reason);
		};
		process.on("unhandledRejection", listener);
		const bridge = createExpressionOperator({
			backend: createKueryBackend(),
			programs: { value: literal(1) },
			namespaces: async () => {
				throw new Error("SECRET selector");
			},
		});
		try {
			expect(() => bridge.operator(["value"], {})).toThrow(/^adapter$/);
			await new Promise((resolve) => setTimeout(resolve, 25));
			expect(errors).toEqual([]);
		} finally {
			bridge.dispose();
			process.off("unhandledRejection", listener);
		}
	});
	it("does not expose host namespace-adapter exception messages", () => {
		const bridge = createExpressionOperator({
			backend: createKueryBackend(),
			programs: { value: literal(1) },
			namespaces() {
				throw new Error("secret");
			},
		});
		expect(() => bridge.operator(["value"], {})).toThrow(/^adapter$/);
		bridge.dispose();
	});
	it("evaluates against actual rule RHS state after native arithmetic and reacts through core", () => {
		const bridge = createExpressionOperator({
			backend: createKueryBackend(),
			programs: { projected: op("add", ref("native"), literal(1)) },
		});
		const session = createSession({
			operators: { custom: { $formbarValue: bridge.operator } },
			rules: [
				{
					name: "total",
					when: { quantity: { $gt: 0 } },
					then: [
						{ $set: { native: { $multiply: ["$quantity", 10] } } },
						{ $set: { projected: { $formbarValue: "projected" } } },
					],
				},
			],
		});
		const form = createForm({
			initialData: { quantity: 1, native: 0, projected: 0 },
			plugins: [createArbiterPlugin({ session })],
		});
		const service = createExpressionService({
			backend: createKueryBackend(),
			namespaces: createCoreExpressionNamespaces(form),
		});
		const props = service.resolveProps({
			value: { mode: "read", expression: op("multiply", ref("projected"), literal(2)) },
		});
		props.subscribe(() => {});
		form.setValue("quantity", 3);
		expect(form.getState().data).toEqual({ quantity: 3, native: 30, projected: 31 });
		expect(props.getSnapshot().values.value).toBe(62);
		form.setValue("quantity", 0);
		form.setValue("quantity", 4);
		expect(form.getState().data.projected).toBe(41);
		expect(props.getSnapshot().values.value).toBe(82);
		props.dispose();
		service.dispose();
		form.dispose();
		session.dispose();
		bridge.dispose();
	});
	it("selects UI and explicit external roots from the current real session scope", () => {
		const bridge = createExpressionOperator({
			backend: createKueryBackend(),
			namespaces: (scope) => ({ pricing: scope.$pricing }),
			programs: { result: op("add", ref("fee", "ui"), ref("rate", "pricing")) },
		});
		const session = createSession({
			namespaces: [{ name: "$pricing" }],
			operators: { custom: { $formbarValue: bridge.operator } },
			rules: [{ name: "external", when: { trigger: true }, then: [{ $set: { result: { $formbarValue: "result" } } }] }],
		});
		session.assert("$ui.fee", 2);
		session.assert("$pricing.rate", 5);
		session.assert("trigger", true);
		session.fire();
		expect(session.getState().result).toBe(7);
		session.dispose();
		bridge.dispose();
	});
	it("enforces authorization, unknown IDs and disposal with code-only failures", () => {
		let allowed = true;
		const bridge = createExpressionOperator({
			backend: createKueryBackend(),
			authorize: () => allowed,
			programs: { value: ref("secret") },
		});
		const session = createSession({
			initialState: { secret: "not-in-diagnostic", trigger: false },
			operators: { custom: { $formbarValue: bridge.operator } },
			rules: [{ name: "denied", when: { trigger: true }, then: [{ $set: { result: { $formbarValue: "value" } } }] }],
		});
		allowed = false;
		session.assert("trigger", true);
		expect(() => session.fire()).toThrow(/^denied$/);
		expect(session.getState().result).toBeUndefined();
		expect(() => bridge.operator(["unknown"], {})).toThrow("unknown-program");
		expect(() => bridge.operator([], {})).toThrow("invalid-input");
		bridge.dispose();
		expect(() => bridge.operator(["value"], {})).toThrow("disposed");
		session.dispose();
	});
});
