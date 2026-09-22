import { ArbiterError, ArbiterErrorCode, createSession } from "@arbitre/core";
import type { ProductionRule, RuleSession } from "@arbitre/core";
import { createForm } from "@formbar/core";
import { describe, expect, test } from "vitest";
import { createArbiterPlugin } from "../arbiter-plugin.js";
import { readFieldPolicyOutput } from "../field-policy-output.js";

const output = (path: string, policy: Record<string, unknown>) => ({ path, ...policy });

function policyRule(name: string, when: ProductionRule["when"], entries: Record<string, unknown>): ProductionRule {
	return { name, when, then: [{ $set: entries }] };
}

function paths(form: ReturnType<typeof createForm>): readonly (readonly (string | number)[])[] {
	return form.getState().fieldPolicy.map((item) => item.path.segments);
}

function tick(form: ReturnType<typeof createForm>, value: number) {
	return form.setValue("tick", value);
}

describe("Arbiter field policy output decoding", () => {
	test("retains every property, false, empty label, producer, and lexical output order", () => {
		const rules = [
			policyRule(
				"policy",
				{ enabled: true },
				{
					"$formbar.fieldPolicy.z-last": output("/z", { required: true }),
					"$formbar.fieldPolicy.a-first": output("/profile/name", {
						visible: false,
						disabled: false,
						readOnly: false,
						required: false,
						label: "",
					}),
				},
			),
		];
		const form = createForm({ initialData: { enabled: false, tick: 0 }, plugins: [createArbiterPlugin({ rules })] });

		form.setValue("enabled", true);
		expect(form.getState().fieldPolicy).toEqual([
			{
				path: { namespace: "data", segments: ["profile", "name"] },
				producerId: "arbiter",
				visible: false,
				disabled: false,
				readOnly: false,
				required: false,
				label: "",
			},
			{ path: { namespace: "data", segments: ["z"] }, producerId: "arbiter", required: true },
		]);
		const previous = form.getState().fieldPolicy;
		tick(form, 1);
		expect(form.getState().fieldPolicy).toBe(previous);
		form.dispose();
	});

	test("normalizes nested, literal dotted, concrete array, leading-zero, and literal $ui data targets", () => {
		const rules = [
			policyRule(
				"paths",
				{ "profile.country": "US" },
				{
					"$formbar.fieldPolicy.array": output("/items/0/code", { disabled: true }),
					"$formbar.fieldPolicy.dot": output("/profile.name", { readOnly: true }),
					"$formbar.fieldPolicy.leading": output("/items/01/code", { required: true }),
					"$formbar.fieldPolicy.nested": output("/profile/contact/email", { visible: false }),
					"$formbar.fieldPolicy.ui-data": output("/$ui/name", { label: "Data $ui" }),
				},
			),
		];
		const form = createForm({
			initialData: { profile: { country: "", contact: { email: "" } }, items: [{ enabled: false }], tick: 0 },
			plugins: [createArbiterPlugin({ rules })],
		});
		form.setValue("profile.country", "US");

		expect(paths(form)).toEqual([
			["items", 0, "code"],
			["profile.name"],
			["items", "01", "code"],
			["profile", "contact", "email"],
			["$ui", "name"],
		]);
		form.setValue("profile.country", "CA");
		expect(form.getState().fieldPolicy).toEqual([]);
		form.dispose();
	});

	test.each([
		["wildcard", { path: "/items/*/name", visible: true }],
		["scope", { path: "$row.name", visible: true }],
		["ui namespace", { path: "$ui.name", visible: true }],
		["bad escape", { path: "/bad~2path", visible: true }],
		["unsafe segment", { path: "/__proto__/name", visible: true }],
	])("rejects unsupported %s target with Arbiter path diagnostics", (_name, record) => {
		expect(() => readFieldPolicyOutput({ getPath: () => ({ target: record }) })).toThrowError(
			expect.objectContaining<Partial<ArbiterError>>({ code: ArbiterErrorCode.INVALID_PATH }),
		);
	});

	test("includes output ID and path in target diagnostics", () => {
		try {
			readFieldPolicyOutput({ getPath: () => ({ repeated: output("/items/*/name", { visible: true }) }) });
			throw new Error("expected path rejection");
		} catch (error) {
			expect(error).toBeInstanceOf(ArbiterError);
			expect((error as ArbiterError).details).toEqual({
				root: "$formbar.fieldPolicy",
				outputId: "repeated",
				path: "/items/*/name",
			});
		}
	});

	test.each([
		["root", []],
		["ID", { "bad.id": output("/name", { visible: true }) }],
		["record", { bad: null }],
		["unknown key", { bad: output("/name", { hidden: true }) }],
		["missing policy", { bad: { path: "/name" } }],
		["boolean type", { bad: output("/name", { visible: 1 }) }],
		["label type", { bad: output("/name", { label: false }) }],
	])("rejects malformed %s with Arbiter compilation diagnostics", (_name, root) => {
		expect(() => readFieldPolicyOutput({ getPath: () => root })).toThrowError(
			expect.objectContaining<Partial<ArbiterError>>({ code: ArbiterErrorCode.RULE_COMPILATION_FAILED }),
		);
	});

	test("rejects duplicate normalized targets atomically", () => {
		const session = createSession();
		const form = createForm({ initialData: { tick: 0 }, plugins: [createArbiterPlugin({ session })] });
		session.assert("$formbar.fieldPolicy.good", output("/items/0/code", { visible: false }));
		expect(tick(form, 1).ok).toBe(true);
		session.assert("$formbar.fieldPolicy.duplicate", output("/items/00/code", { required: true }));
		expect(tick(form, 2)).toMatchObject({ ok: true });
		const previous = form.getState().fieldPolicy;
		session.assert("$formbar.fieldPolicy.duplicate", output("/items/0/code", { required: true }));
		const failed = tick(form, 3);
		expect(failed.ok).toBe(false);
		expect(failed.error).toContain("target the same path");
		expect(form.getState().fieldPolicy).toBe(previous);
		expect((form.getState().data as { tick: number }).tick).toBe(2);
		form.dispose();
	});

	test("rejects a malformed replacement without changing the committed snapshot", () => {
		const session = createSession();
		const form = createForm({ initialData: { tick: 0 }, plugins: [createArbiterPlugin({ session })] });
		session.assert("$formbar.fieldPolicy.target", output("/name", { visible: false }));
		tick(form, 1);
		const previous = form.getState().fieldPolicy;
		session.assert("$formbar.fieldPolicy.target", output("/name", { visible: "no" }));
		expect(tick(form, 2)).toMatchObject({ ok: false });
		expect(form.getState().fieldPolicy).toBe(previous);
		form.dispose();
	});
});

describe("Arbiter policy snapshot synchronization", () => {
	test("replaces moved output and clears deactivated and explicitly unset output", () => {
		const rules: readonly ProductionRule[] = [
			{
				name: "move",
				when: { active: true },
				then: [{ $set: { "$formbar.fieldPolicy.target": output("/old", { visible: false }) } }],
			},
			{
				name: "clear",
				when: { clear: true },
				then: [{ $unset: { "$formbar.fieldPolicy.target": true } }],
			},
		];
		const session = createSession({ rules });
		const form = createForm({
			initialData: { active: false, clear: false, tick: 0 },
			plugins: [createArbiterPlugin({ session })],
		});
		form.setValue("active", true);
		expect(paths(form)).toEqual([["old"]]);
		session.assert("$formbar.fieldPolicy.target", output("/new", { visible: false }));
		tick(form, 1);
		expect(paths(form)).toEqual([["new"]]);
		form.setValue("clear", true);
		expect(form.getState().fieldPolicy).toEqual([]);
		form.dispose();
	});

	test("observes borrowed rule removal and output cessation on the next relevant tick", () => {
		const session = createSession({
			rules: [
				policyRule(
					"borrowed",
					{ active: true },
					{ "$formbar.fieldPolicy.borrowed": output("/name", { required: true }) },
				),
			],
		});
		const form = createForm({ initialData: { active: false, tick: 0 }, plugins: [createArbiterPlugin({ session })] });
		form.setValue("active", true);
		expect(form.getState().fieldPolicy).toHaveLength(1);
		session.removeRule("borrowed");
		tick(form, 1);
		expect(form.getState().fieldPolicy).toEqual([]);
		session.assert("$formbar.fieldPolicy.host", output("/host", { disabled: true }));
		tick(form, 2);
		expect(paths(form)).toEqual([["host"]]);
		session.retract("$formbar.fieldPolicy.host");
		tick(form, 3);
		expect(form.getState().fieldPolicy).toEqual([]);
		form.dispose();
		expect(() => session.assert("hostOwned", true)).not.toThrow();
		session.dispose();
	});

	test("retracts synchronized roots that disappear and resynchronizes after reset", () => {
		const session = createSession({
			rules: [
				policyRule(
					"dynamic",
					{ dynamic: true },
					{ "$formbar.fieldPolicy.dynamic": output("/dynamic", { visible: false }) },
				),
			],
		});
		const form = createForm({
			initialData: { tick: 0 },
			initialUiState: {},
			plugins: [createArbiterPlugin({ session })],
		});
		form.setValue("dynamic", true);
		form.setValue("$ui.transient", true);
		expect(form.getState().fieldPolicy).toHaveLength(1);
		expect(session.getPath("$ui.transient")).toBe(true);
		form.reset();
		expect(form.getState().fieldPolicy).toEqual([]);
		tick(form, 1);
		expect(session.getPath("dynamic")).toBeUndefined();
		expect(session.getPath("$ui.transient")).toBeUndefined();
		expect(form.getState().fieldPolicy).toEqual([]);
		form.dispose();
	});

	test("keeps policy on skipped evaluation and disposes only owned sessions", () => {
		const ownedPlugin = createArbiterPlugin({
			rules: [
				policyRule("owned", { active: true }, { "$formbar.fieldPolicy.owned": output("/name", { visible: false }) }),
			],
		});
		const form = createForm({ initialData: { active: false }, plugins: [ownedPlugin] });
		form.setValue("active", true);
		const previous = form.getState().fieldPolicy;
		const context = {
			action: { type: "init" },
			data: form.getState().data,
			uiState: form.getState().uiState,
			prevData: form.getState().data,
			prevUiState: form.getState().uiState,
			change: { type: "init", path: undefined, dataChanged: false, uiChanged: false },
			issues: [],
			origin: "init",
			getValueAtPath: () => undefined,
		} as const;
		const skipped = ownedPlugin.evaluate?.(context);
		expect(skipped).toBeUndefined();
		expect(form.getState().fieldPolicy).toBe(previous);
		form.dispose();
		expect(() =>
			ownedPlugin.evaluate?.({
				...context,
				change: { ...context.change, dataChanged: true },
			}),
		).toThrowError(expect.objectContaining<Partial<ArbiterError>>({ code: ArbiterErrorCode.SESSION_DISPOSED }));
	});

	test("models demo-21-style section fields with concrete policy targets", () => {
		const rules = [
			policyRule(
				"employment",
				{ "profile.employed": true },
				{
					"$formbar.fieldPolicy.company": output("/profile/employment/company", { visible: true, required: true }),
					"$formbar.fieldPolicy.role": output("/profile/employment/role", { visible: true }),
				},
			),
		];
		const form = createForm({
			initialData: { profile: { employed: false, employment: { company: "", role: "" } } },
			plugins: [createArbiterPlugin({ rules })],
		});
		form.setValue("profile.employed", true);
		expect(paths(form)).toEqual([
			["profile", "employment", "company"],
			["profile", "employment", "role"],
		]);
		form.setValue("profile.employed", false);
		expect(form.getState().fieldPolicy).toEqual([]);
		form.dispose();
	});
});
