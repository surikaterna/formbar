import type { JsonValue } from "@formbar/expressions";
import { describe, expect, it, vi } from "vitest";
import { normalizeExtensions } from "../../../react-schema/src/extension-registry.js";
import { normalizeActions } from "../action-registry.js";
import {
	checkPolicyDeclaration,
	checkPolicyNamespace,
	checkPolicySchemaSide,
	snapshotAdmissionPolicy,
} from "../validators/kalada-policy.js";
import { ProgramAdmissionError } from "../validators/kalada-program.js";

const identity = { generation: "g1", fingerprint: "installed-v1" };
const handler = vi.fn();
const component = vi.fn();
const validateProps = vi.fn(() => true);
const extensions = normalizeExtensions({
	widgets: [{ id: "trusted.widget", component, validateProps }],
	nodes: [{ id: "trusted.renderer", component, validateProps }],
});
const actions = normalizeActions([{ id: "trusted.action", handler }]);

function hostPolicy() {
	return {
		...identity,
		widgets: Object.fromEntries(
			[...extensions.widgets.keys()].map((id) => [
				id,
				{
					children: "forbidden",
					props: { title: { modes: ["literal"], expected: "string" } },
				},
			]),
		),
		renderers: Object.fromEntries(
			[...extensions.nodes.keys()].map((id) => [
				id,
				{
					children: "allowed",
					props: { title: { modes: ["literal", "read"], expected: "string" } },
				},
			]),
		),
		actions: Object.fromEntries(
			[...actions.handlers.keys()].map((id) => [
				id,
				{
					children: "forbidden",
					props: {},
				},
			]),
		),
		namespaces: { data: "available", ui: "unavailable" },
		schema: { side: "input", availability: "complete", paths: [] },
		ui: { availability: "unavailable", paths: [] },
	};
}

describe("private host-owned policy snapshot", () => {
	it("copies and freezes inert metadata tied to real installed normalized IDs, without executing registrations", () => {
		const source = hostPolicy();
		const policy = snapshotAdmissionPolicy(source);
		source.widgets["trusted.widget"].props.title.expected = "boolean";
		expect(Object.isFrozen(policy.widgets["trusted.widget"]?.props.title?.modes)).toBe(true);
		checkPolicyDeclaration(policy, identity, "widget", "trusted.widget", "root.children[0].widget", {
			title: { mode: "literal", value: "ok" },
		});
		checkPolicyDeclaration(
			policy,
			identity,
			"renderer",
			"trusted.renderer",
			"root.renderer",
			{
				title: { mode: "read" },
			},
			true,
		);
		checkPolicyDeclaration(policy, identity, "action", "trusted.action", "root.action");
		checkPolicyNamespace(policy, identity, "data", "root.binding.namespace");
		checkPolicySchemaSide(policy, identity, "input", "root.binding");
		expect(component).not.toHaveBeenCalled();
		expect(handler).not.toHaveBeenCalled();
		expect(validateProps).not.toHaveBeenCalled();
	});

	it("fails closed on absent or stale provenance, missing metadata, reserved IDs and incompatible declarations", () => {
		const policy = snapshotAdmissionPolicy(hostPolicy());
		const check = (name: string, props = {}, children = false) =>
			checkPolicyDeclaration(policy, identity, "widget", name, "root.widget", props, children);
		expect(() => check("missing")).toThrowError("root.widget: MISSING_POLICY");
		expect(() => check("text")).toThrowError("root.widget: RESERVED_ID");
		expect(() => check("trusted.widget", { unknown: { mode: "literal", value: 1 } })).toThrowError(
			"root.widget.props.unknown: MISSING_POLICY",
		);
		expect(() => check("trusted.widget", { title: { mode: "write" } })).toThrowError(
			"root.widget.props.title.mode: FORBIDDEN_PROP_MODE",
		);
		expect(() => check("trusted.widget", { title: { mode: "literal", value: 3 } })).toThrowError(
			"root.widget.props.title.value: INVALID_PROP_TYPE",
		);
		expect(() => check("trusted.widget", {}, true)).toThrowError("root.widget.children: FORBIDDEN_CHILDREN");
		expect(() =>
			checkPolicyDeclaration(policy, { ...identity, generation: "g2" }, "widget", "trusted.widget", "root.widget"),
		).toThrowError("root.widget: STALE_POLICY");
		expect(() => checkPolicyNamespace(policy, identity, "ui", "root.binding.namespace")).toThrowError(
			"root.binding.namespace: MISSING_NAMESPACE_POLICY",
		);
		expect(() => checkPolicySchemaSide(policy, identity, "output", "root.binding")).toThrowError(
			"root.binding: MISSING_SCHEMA_POLICY",
		);
		expect(() => checkPolicyDeclaration(policy, identity, "action", "submit", "root.action")).toThrowError(
			"root.action: RESERVED_ID",
		);
	});

	it("rejects callback/accessor metadata and incomplete host facts at construction", () => {
		const getter = vi.fn(() => "available");
		const input = hostPolicy();
		expect(() =>
			snapshotAdmissionPolicy({
				...input,
				namespaces: Object.defineProperty({}, "data", {
					enumerable: true,
					get: getter,
				}),
			}),
		).toThrowError("policy: INVALID_POLICY");
		expect(getter).not.toHaveBeenCalled();
		expect(() =>
			snapshotAdmissionPolicy({ ...input, widgets: { text: input.widgets["trusted.widget"] } }),
		).toThrowError("policy.widgets.text: INVALID_POLICY");
		expect(() =>
			snapshotAdmissionPolicy({ ...input, actions: { "trusted.action": { children: "forbidden" } } }),
		).toThrowError("policy.actions.trusted.action.props: INVALID_POLICY");
		expect(() => snapshotAdmissionPolicy({ ...input, schema: {} })).toThrowError("policy.schema: INVALID_POLICY");
		expect(() =>
			snapshotAdmissionPolicy({
				...input,
				renderers: {
					"trusted.renderer": {
						children: "allowed",
						props: { cb: { modes: ["literal"], expected: "json", fn: handler } },
					},
				},
			}),
		).toThrowError("policy: INVALID_POLICY");
	});

	it("admits only own, bounded JSON literals at the private policy boundary", () => {
		const source = hostPolicy();
		source.widgets["trusted.widget"].props.title.expected = "json";
		source.widgets["trusted.widget"].props.title.modes = ["literal", "read", "write"];
		const policy = snapshotAdmissionPolicy(source);
		const check = (spec: { mode: string; value?: JsonValue }) =>
			checkPolicyDeclaration(policy, identity, "widget", "trusted.widget", "root.widget", { title: spec });
		for (const value of [null, true, false, "ok", 0, 3.5, [], [1, { ok: null }], { nested: [false] }])
			expect(() => check({ mode: "literal", value })).not.toThrow();
		const missing = Object.create({ value: "inherited" }) as { mode: string; value?: JsonValue };
		missing.mode = "literal";
		for (const spec of [{ mode: "literal" }, { mode: "literal", value: undefined }, missing])
			expect(() => check(spec)).toThrowError(/^root\.widget\.props\.title\.value: INVALID_PROP_TYPE$/);
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		const accessor = Object.defineProperty({}, "secret", { enumerable: true, get: handler });
		const unsafe = Object.defineProperty({}, "__proto__", { enumerable: true, value: 1 });
		const sparse = new Array(2);
		sparse[1] = 1;
		for (const value of [
			() => 1,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			Number.NEGATIVE_INFINITY,
			circular,
			accessor,
			unsafe,
			new Date(),
			sparse,
			"a".repeat(16385),
		])
			expect(() => check({ mode: "literal", value: value as JsonValue })).toThrowError(
				/^root\.widget\.props\.title\.value: INVALID_PROP_TYPE$/,
			);
		expect(handler).not.toHaveBeenCalled();
		expect(() => check({ mode: "read" })).not.toThrow();
		expect(() => check({ mode: "write" })).not.toThrow();
		expect(() => check({ mode: "execute" })).toThrowError("root.widget.props.title.mode: FORBIDDEN_PROP_MODE");
	});

	it("rejects declaration accessors without calling getters, with precise paths", () => {
		const source = hostPolicy();
		source.widgets["trusted.widget"].props.title.modes = ["literal", "read", "write"];
		const policy = snapshotAdmissionPolicy(source);
		const check = (props: Record<string, unknown>) =>
			checkPolicyDeclaration(policy, identity, "widget", "trusted.widget", "root.widget", props as never);
		const getter = vi.fn(() => {
			throw new Error("getter executed");
		});
		const accessor = (key: string, initial: object = {}) =>
			Object.defineProperty(initial, key, { enumerable: true, configurable: true, get: getter });
		const setter = vi.fn();
		const setterOnly = (key: string, initial: object = {}) =>
			Object.defineProperty(initial, key, { enumerable: true, set: setter });
		const cases: [Record<string, unknown>, string, string][] = [
			[accessor("title"), "root.widget.props.title", "INVALID_PROP_TYPE"],
			[setterOnly("title"), "root.widget.props.title", "INVALID_PROP_TYPE"],
			[{ title: accessor("mode", { value: "ok" }) }, "root.widget.props.title.mode", "FORBIDDEN_PROP_MODE"],
			[{ title: setterOnly("mode") }, "root.widget.props.title.mode", "FORBIDDEN_PROP_MODE"],
			[{ title: accessor("value", { mode: "literal" }) }, "root.widget.props.title.value", "INVALID_PROP_TYPE"],
			[{ title: setterOnly("value", { mode: "literal" }) }, "root.widget.props.title.value", "INVALID_PROP_TYPE"],
			[{ title: accessor("value", { mode: "read" }) }, "root.widget.props.title.value", "INVALID_PROP_TYPE"],
			[{ title: accessor("value", { mode: "write" }) }, "root.widget.props.title.value", "INVALID_PROP_TYPE"],
		];
		for (const [props, path, code] of cases) {
			expect(() => check(props)).toThrowError(ProgramAdmissionError);
			try {
				check(props);
			} catch (error) {
				expect(error).toMatchObject({ path, code, message: `${path}: ${code}` });
			}
		}
		expect(getter).toHaveBeenCalledTimes(0);
		expect(setter).toHaveBeenCalledTimes(0);
		const inheritedMode = Object.create({ mode: "literal" }) as Record<string, unknown>;
		inheritedMode.value = "ok";
		expect(() => check({ title: inheritedMode })).toThrowError("root.widget.props.title.mode: FORBIDDEN_PROP_MODE");
		expect(() => check({ title: { value: "ok" } })).toThrowError("root.widget.props.title.mode: FORBIDDEN_PROP_MODE");
		const inheritedValue = Object.create({ value: "ok" }) as Record<string, unknown>;
		inheritedValue.mode = "literal";
		expect(() => check({ title: inheritedValue })).toThrowError("root.widget.props.title.value: INVALID_PROP_TYPE");
		expect(() => check({ title: { mode: "literal" } })).toThrowError(
			"root.widget.props.title.value: INVALID_PROP_TYPE",
		);
		expect(() => check({ title: { mode: "read" } })).not.toThrow();
		expect(() => check({ title: { mode: "write" } })).not.toThrow();
	});

	it("rejects hidden, inherited and unsafe declaration keys at their exact paths without invoking getters", () => {
		const policy = snapshotAdmissionPolicy(hostPolicy());
		const check = (props: object) =>
			checkPolicyDeclaration(policy, identity, "widget", "trusted.widget", "root.widget", props as never);
		const getter = vi.fn(() => {
			throw new Error("unexpected getter call");
		});
		const inherited = Object.create({ title: { mode: "literal", value: "ok" } });
		const hidden = Object.defineProperty({}, "title", { value: { mode: "literal", value: "ok" } });
		const symbol = Object.defineProperty({}, Symbol("hidden"), { value: 1 });
		const accessor = Object.defineProperty({}, "title", { get: getter });
		const inheritedGetter = Object.create(Object.defineProperty({}, "title", { get: getter }));
		const unsafe = Object.defineProperty({}, "__proto__", { value: 1, enumerable: true });
		const constructorKey = Object.defineProperty({}, "constructor", { value: 1, enumerable: true });
		const prototypeKey = Object.defineProperty({}, "prototype", { value: 1, enumerable: true });
		for (const [props, path] of [
			[inherited, "root.widget.props.title"],
			[inheritedGetter, "root.widget.props.title"],
			[hidden, "root.widget.props.title"],
			[symbol, "root.widget.props.Symbol(hidden)"],
			[accessor, "root.widget.props.title"],
			[unsafe, "root.widget.props.__proto__"],
			[constructorKey, "root.widget.props.constructor"],
			[prototypeKey, "root.widget.props.prototype"],
		] as const) {
			try {
				check(props);
				throw new Error("accepted unsafe props");
			} catch (error) {
				expect(error).toMatchObject({ path, code: "INVALID_PROP_TYPE", message: `${path}: INVALID_PROP_TYPE` });
			}
		}
		const extras = Object.defineProperty(Object.prototype, "customInherited", { get: getter, configurable: true });
		try {
			expect(() => check({})).toThrowError("root.widget.props.customInherited: INVALID_PROP_TYPE");
		} finally {
			Reflect.deleteProperty(extras, "customInherited");
		}
		expect(getter).not.toHaveBeenCalled();
		expect(() => check({ title: { mode: "literal", value: "ok" } })).not.toThrow();
		const jsonProps = Object.assign(Object.create(null), { title: { mode: "literal", value: "ok" } });
		expect(() => check(jsonProps)).not.toThrow();
	});

	it("rejects hidden spec fields and extras without invoking accessors", () => {
		const policy = snapshotAdmissionPolicy(hostPolicy());
		const check = (spec: object) =>
			checkPolicyDeclaration(policy, identity, "widget", "trusted.widget", "root.widget", { title: spec } as never);
		const getter = vi.fn(() => "literal");
		for (const [spec, path, code] of [
			[
				Object.defineProperty({ value: "ok" }, "mode", { value: "literal" }),
				"root.widget.props.title.mode",
				"FORBIDDEN_PROP_MODE",
			],
			[
				Object.defineProperty({ mode: "literal" }, "value", { value: "ok" }),
				"root.widget.props.title.value",
				"INVALID_PROP_TYPE",
			],
			[
				Object.defineProperty({ mode: "literal", value: "ok" }, "extra", { get: getter }),
				"root.widget.props.title.extra",
				"INVALID_PROP_TYPE",
			],
		] as const)
			expect(() => check(spec)).toThrowError(`${path}: ${code}`);
		expect(getter).not.toHaveBeenCalled();
	});
});
