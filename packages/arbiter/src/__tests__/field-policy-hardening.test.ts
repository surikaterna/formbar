import { type ArbiterError, ArbiterErrorCode, createSession } from "@arbitre/core";
import type { ProductionRule } from "@arbitre/core";
import { createForm } from "@formbar/core";
import { describe, expect, test } from "vitest";
import { createArbiterPlugin } from "../arbiter-plugin.js";
import { readFieldPolicyOutput } from "../field-policy-output.js";

const output = (path: string, policy: Record<string, unknown>) => ({ path, ...policy });
const source = (record: unknown) => ({ getPath: () => ({ target: record }) });

function expectCompilationError(run: () => unknown): void {
	expect(run).toThrowError(
		expect.objectContaining<Partial<ArbiterError>>({ code: ArbiterErrorCode.RULE_COMPILATION_FAILED }),
	);
}

describe("field policy descriptor boundary", () => {
	test("captures every descriptor once and returns fresh frozen validated data", () => {
		const target = { path: "/victim", visible: false, label: "" };
		const descriptorReads = new Map<PropertyKey, number>();
		let getReads = 0;
		const changing = new Proxy(target, {
			get(target, key, receiver) {
				getReads++;
				return Reflect.get(target, key, receiver);
			},
			getOwnPropertyDescriptor(target, key) {
				descriptorReads.set(key, (descriptorReads.get(key) ?? 0) + 1);
				const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
				if (key !== "visible" || !descriptor) return descriptor;
				return { ...descriptor, value: descriptorReads.get(key) === 1 ? false : undefined };
			},
		});

		const result = readFieldPolicyOutput(source(changing));
		expect(result).toEqual([{ path: "/victim", visible: false, label: "" }]);
		expect(getReads).toBe(0);
		expect([...descriptorReads.values()]).toEqual([1, 1, 1]);
		expect(Object.isFrozen(result)).toBe(true);
		expect(Object.isFrozen(result[0])).toBe(true);
		target.visible = true;
		expect(result[0]?.visible).toBe(false);
		expect(result[0]).not.toBe(changing);
	});

	test("does not execute a throwing get trap", () => {
		let getReads = 0;
		const throwingGet = new Proxy(output("/safe", { required: true }), {
			get() {
				getReads++;
				throw new Error("get trap must not execute");
			},
		});
		expect(readFieldPolicyOutput(source(throwingGet))).toEqual([{ path: "/safe", required: true }]);
		expect(getReads).toBe(0);
	});

	test("commits captured values rather than a borrowed session proxy", () => {
		let visibleReads = 0;
		const changing = new Proxy(output("/victim", { visible: false, label: "" }), {
			get(target, key, receiver) {
				if (key !== "visible") return Reflect.get(target, key, receiver);
				visibleReads++;
				return visibleReads === 1 ? false : undefined;
			},
		});
		const session = createSession();
		const form = createForm({ initialData: { tick: 0 }, plugins: [createArbiterPlugin({ session })] });
		session.assert("$formbar.fieldPolicy.proxy", changing);
		expect(form.setValue("tick", 1).ok).toBe(true);
		expect(visibleReads).toBe(0);
		expect(form.getState().fieldPolicy).toMatchObject([
			{ path: { namespace: "data", segments: ["victim"] }, producerId: "arbiter", visible: false, label: "" },
		]);
		form.dispose();
		session.dispose();
	});

	test("converts ownKeys and descriptor trap failures to Arbiter diagnostics", () => {
		const throwingOwnKeys = new Proxy(output("/name", { visible: true }), {
			ownKeys() {
				throw new Error("ownKeys");
			},
		});
		const throwingDescriptor = new Proxy(output("/name", { visible: true }), {
			getOwnPropertyDescriptor() {
				throw new Error("descriptor");
			},
		});
		expectCompilationError(() => readFieldPolicyOutput(source(throwingOwnKeys)));
		expectCompilationError(() => readFieldPolicyOutput(source(throwingDescriptor)));
		const revoked = Proxy.revocable(output("/name", { visible: true }), {});
		revoked.revoke();
		expectCompilationError(() => readFieldPolicyOutput(source(revoked.proxy)));
	});

	test("converts a throwing reserved-root get trap to Arbiter diagnostics", () => {
		const session = createSession();
		const throwingRoot = new Proxy(
			{ fieldPolicy: {} },
			{
				get() {
					throw new Error("reserved-root-get");
				},
			},
		);
		session.assert("$formbar", throwingRoot);
		expectCompilationError(() => readFieldPolicyOutput(session));
		session.dispose();
	});

	test("rejects accessors without invoking getters", () => {
		let getterReads = 0;
		const accessor = Object.defineProperty({ path: "/name" }, "visible", {
			enumerable: true,
			get() {
				getterReads++;
				return true;
			},
		});
		expectCompilationError(() => readFieldPolicyOutput(source(accessor)));
		expect(getterReads).toBe(0);
	});

	test("rejects custom prototypes and unknown properties", () => {
		const custom = Object.assign(Object.create({ inherited: true }), output("/name", { visible: true }));
		expectCompilationError(() => readFieldPolicyOutput(source(custom)));
		expectCompilationError(() => readFieldPolicyOutput(source(output("/name", { visible: true, hidden: true }))));
	});

	test("retains the prior core snapshot when hostile session state fails", () => {
		const session = createSession();
		const form = createForm({ initialData: { tick: 0 }, plugins: [createArbiterPlugin({ session })] });
		session.assert("$formbar.fieldPolicy.target", output("/name", { visible: false }));
		expect(form.setValue("tick", 1).ok).toBe(true);
		const previous = form.getState().fieldPolicy;
		const hostile = new Proxy(output("/other", { visible: true }), {
			ownKeys() {
				throw new Error("hostile-ownKeys");
			},
		});
		session.assert("$formbar.fieldPolicy.target", hostile);
		const failed = form.setValue("tick", 2);
		expect(failed).toMatchObject({ ok: false, error: "Arbiter session state could not be evaluated safely" });
		expect(form.getState().fieldPolicy).toBe(previous);
		expect((form.getState().data as { tick: number }).tick).toBe(1);
		form.dispose();
		session.dispose();
	});
});

describe("reserved $formbar synchronization boundary", () => {
	const malicious = {
		fieldPolicy: {
			injected: { path: "/victim", visible: false },
			legit: { path: "/overridden", required: false },
		},
		userPayload: "retained-only-in-form-data",
	};

	test("ignores reserved user data while synchronizing ordinary data and UI", () => {
		const session = createSession();
		const form = createForm({
			initialData: {
				$formbar: malicious,
				"$formbar.fieldPolicy.direct": output("/direct", { visible: false }),
				profile: { name: "Ada" },
				tick: 0,
			},
			initialUiState: { ready: true },
			plugins: [createArbiterPlugin({ session })],
		});
		expect(form.setValue("tick", 1).ok).toBe(true);
		expect(form.getState().fieldPolicy).toEqual([]);
		expect(session.getPath("$formbar")).toBeUndefined();
		expect(session.getPath("profile")).toEqual({ name: "Ada" });
		expect(session.getPath("$ui.ready")).toBe(true);
		form.dispose();
		expect(() => session.assert("hostOwned", true)).not.toThrow();
		session.dispose();
	});

	test("cannot override or receive rule-owned output and clears it on the next tick", () => {
		const rules: readonly ProductionRule[] = [
			{
				name: "legitimate",
				when: { active: true },
				then: [{ $set: { "$formbar.fieldPolicy.legit": output("/legitimate", { required: true }) } }],
			},
		];
		const session = createSession({ rules });
		const form = createForm({
			initialData: { $formbar: malicious, active: false, tick: 0 },
			initialUiState: {},
			plugins: [createArbiterPlugin({ session })],
		});
		form.setValue("active", true);
		form.setValue("tick", 1);
		expect(form.getState().fieldPolicy).toMatchObject([
			{ path: { namespace: "data", segments: ["legitimate"] }, producerId: "arbiter", required: true },
		]);
		expect(session.getPath("$formbar.fieldPolicy.injected")).toBeUndefined();
		expect((form.getState().data as Record<string, unknown>).$formbar).toEqual(malicious);
		expect((form.getState().uiState as Record<string, unknown>).$formbar).toBeUndefined();

		form.reset();
		expect(form.getState().fieldPolicy).toEqual([]);
		form.setValue("tick", 1);
		expect(form.getState().fieldPolicy).toEqual([]);
		expect(session.getPath("$formbar.fieldPolicy.legit")).toBeUndefined();
		form.dispose();
		expect(() => session.assert("stillOwned", true)).not.toThrow();
		session.dispose();
	});
});
