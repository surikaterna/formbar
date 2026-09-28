import { expect, it } from "vitest";
import { snapshotAdmissionPolicy } from "../../../packages/declarative/src/validators/kalada-policy.js";
import { createPrivateKaladaRuntime } from "../../../packages/declarative/src/validators/kalada-private-runtime.js";
import { repeaterWire } from "./repeater-write-wire.js";
import { type TreeState, node, quantityPath, referencePath, serialHost, versionedHost } from "./row-write-hosts.js";

const binding = "root.children[0].children[0].binding";
const path = ["rows", { row: "outer" }, "nested", { row: "inner" }, "quantity"];
const ref = (segments: string[], scope?: string) => ({ namespace: "data", segments, ...(scope ? { scope } : {}) });
const definition = {
	version: 1,
	id: "form",
	root: {
		type: "repeater",
		id: "list",
		scope: "outer",
		binding: ref(["rows"]),
		children: [
			{
				type: "repeater",
				id: "nested",
				scope: "inner",
				binding: ref(["nested"], "outer"),
				children: [{ type: "field", id: "editable", widget: "text", binding: ref(["quantity"], "inner") }],
			},
		],
	},
};
const identity = { generation: "g1", fingerprint: "host" };
const policy = snapshotAdmissionPolicy({
	...identity,
	widgets: {},
	renderers: {},
	actions: {},
	namespaces: { data: "available" },
	schema: {
		side: "input",
		availability: "complete",
		paths: [
			{ path: ["rows"], kind: "array" },
			{ path: ["rows", { row: "outer" }, "nested"], kind: "array" },
			{ path, kind: "value" },
		],
	},
	ui: { availability: "complete", paths: [] },
});
const locations = {
	[binding]: {
		line: {
			target: ref([], "inner"),
			type: { kind: "primitive-type" as const, name: "json" as const },
			writable: true as const,
			properties: {
				quantity: { type: { kind: "primitive-type" as const, name: "string" as const }, writable: true as const },
			},
		},
	},
};

type Host = ReturnType<typeof serialHost> | ReturnType<typeof versionedHost>;
function setup(factory: () => Host, wire = false, shared?: { host: Host; bridge: ReturnType<typeof repeaterWire> }) {
	const host = shared?.host ?? factory();
	const bridge = shared?.bridge ?? (wire ? repeaterWire(host.strategy) : undefined);
	const form = createPrivateKaladaRuntime({
		definition,
		policy,
		identity,
		strategy: bridge?.strategy ?? host.strategy,
		directLocations: locations,
	});
	const instance = [...host.states.keys()].at(-1) as object;
	const outer = form.capture().enumerateRows("root");
	if (!outer.ok || !outer.rows[0]) throw new Error("missing outer");
	const inner = form.capture().enumerateRows("root.children[0]", outer.rows[0].scope);
	if (!inner.ok || !inner.rows[0]) throw new Error("missing inner");
	const row = inner.rows[0];
	const callback = form.bindRowWrite(binding, "line.quantity", row);
	if (!callback) throw new Error("missing handler");
	return { host, form, instance, row, callback, bridge };
}

const ids = new WeakMap<object, number>();
let nextId = 0;
function id(value: object): number {
	let result = ids.get(value);
	if (!result) {
		result = ++nextId;
		ids.set(value, result);
	}
	return result;
}
function state(host: Host, instance: object, bridge?: ReturnType<typeof repeaterWire>) {
	const current = host.states.get(instance);
	if (!current) throw new Error("missing state");
	const row = (item: {
		id: string;
		value: string;
		quantity: string;
		token: object;
		revision: object;
		denied: boolean;
		readOnly: boolean;
		children: unknown[];
	}) => [
		item.id,
		item.value,
		id(item.token),
		id(item.revision),
		item.denied,
		item.readOnly,
		item.children.map((child) => (typeof child === "string" ? child : id(child as object))),
		item.quantity,
	];
	const versioned = "version" in current;
	const version = versioned ? current.version : current;
	return {
		owner: id(version),
		revision: id(version.revision),
		field: { ...version.field },
		roots: versioned ? [...current.version.roots] : current.roots.map((item) => id(item)),
		registryKeys: versioned ? [...current.version.nodes.keys()] : [],
		nodeIdentities: versioned
			? [...current.version.nodes.values()].map(id)
			: current.roots.flatMap((item) => [item, ...item.children]).map(id),
		rows: versioned
			? [...current.version.nodes.values()].map(row)
			: current.roots.flatMap((item) => [item, ...item.children]).map(row),
		notices: host.notifications.mock.calls.length,
		outgoing: bridge ? [...bridge.requests] : [],
	};
}

type Scenario = "revoked" | "readOnly" | "removed" | "replaced" | "duplicate" | "conflict" | "stale" | "throw";
function disrupt(host: Host, instance: object, scenario: Scenario) {
	const current = host.states.get(instance);
	if (!current) throw new Error("missing state");
	const child = "version" in current ? current.version.nodes.get("child") : current.roots[0]?.children[0];
	if (!child) throw new Error("missing child");
	if (scenario === "revoked") child.denied = true;
	if (scenario === "readOnly") child.readOnly = true;
	if (scenario === "conflict") child.revision = {};
	if (scenario === "stale") {
		if ("version" in current) current.version.revision = {};
		else current.revision = {};
	}
	if (scenario === "duplicate") {
		if ("version" in current) current.version.roots.push("first");
		else current.roots.push(current.roots[0] as TreeState["roots"][number]);
	}
	if (scenario === "removed" || scenario === "replaced") {
		if ("version" in current) {
			if (scenario === "replaced") current.version.nodes.set("replacement", node("replacement", "replacement"));
			current.version.roots.splice(0, 1, scenario === "replaced" ? "replacement" : "second");
		} else {
			const replacement = { ...node("replacement", "replacement"), children: [] };
			current.roots.splice(
				0,
				1,
				scenario === "replaced" ? replacement : (current.roots[1] as TreeState["roots"][number]),
			);
		}
	}
	return current;
}

function checkDenial(factory: () => Host, scenario: Scenario, status: string) {
	const { host, form, instance, bridge, callback } = setup(factory, true);
	if (!bridge) throw new Error("missing bridge");
	const current = host.states.get(instance);
	if (!current) throw new Error("missing state");
	const child = "version" in current ? current.version.nodes.get("child") : current.roots[0]?.children[0];
	if (!child) throw new Error("missing child");
	child.denied = true;
	expect(callback("forbidden")).toEqual({ status: "denied" });
	child.denied = false;
	const wire = bridge.requests[0] as string;
	disrupt(host, instance, scenario);
	const before = state(host, instance, bridge);
	if (scenario === "throw") host.states.delete(instance);
	expect(bridge.handle(wire, bridge.open(instance)), scenario).toBe(JSON.stringify({ status }));
	if (scenario === "throw") host.states.set(instance, current as never);
	expect(state(host, instance, bridge), scenario).toEqual(before);
	form.dispose();
}

for (const [name, factory] of [
	["serial tree", serialHost],
	["versioned registry", versionedHost],
] as const) {
	it(`${name}: host reads exact row fields and rejects malformed references without mutation`, () => {
		const { host, form, instance, row } = setup(factory);
		const context = { instance, policyGeneration: "g1", policyFingerprint: "host" };
		const capture = host.strategy.capture(context);
		const value = { namespace: "data", path: referencePath };
		const quantity = { namespace: "data", path: quantityPath };
		expect(capture.read(value, row.scope)).toEqual({ status: "found", value: "child" });
		expect(capture.read(quantity, row.scope)).toEqual({ status: "found", value: "child-quantity" });
		const request = {
			contract: "formbar-direct-write-v1" as const,
			targetKind: "row" as const,
			expectedInstance: instance,
			expectedRevision: capture.token,
			expectedRowRevision: row.writeRevision,
			reference: quantity,
			scope: row.scope,
			value: "wrong",
		};
		const before = state(host, instance);
		for (const reference of [
			{ namespace: "ui", path: quantityPath },
			{ namespace: "data", path: [...quantityPath.slice(0, -1), "unknown"] },
			{ namespace: "data", path: [...quantityPath, "extra"] },
			{ namespace: "data", path: ["rows", { row: "inner" }, "nested", { row: "outer" }, "quantity"] },
			{ namespace: "data", path: ["rows", { row: "outer", extra: undefined }, "nested", { row: "inner" }, "quantity"] },
		]) {
			expect(capture.read(reference, row.scope)).toEqual({ status: "missing" });
			expect(host.strategy.writeDirect?.(context, { ...request, reference })).toEqual({ status: "invalid-target" });
			expect(state(host, instance)).toEqual(before);
		}
		const wrongScope = {
			rows: [
				row.scope.rows[1] as (typeof row.scope.rows)[number],
				row.scope.rows[0] as (typeof row.scope.rows)[number],
			],
		};
		expect(capture.read(quantity, wrongScope)).toEqual({ status: "missing" });
		expect(host.strategy.writeDirect?.(context, { ...request, scope: wrongScope })).toEqual({
			status: "invalid-target",
		});
		expect(state(host, instance)).toEqual(before);
		form.dispose();
	});
	it(`${name}: serialized B request is bound to host-owned B session, not A`, () => {
		const a = setup(factory, true);
		const bridge = a.bridge;
		if (!bridge) throw new Error("missing bridge");
		const b = setup(factory, false, { host: a.host, bridge });
		const capture = () => [state(a.host, a.instance, bridge), state(a.host, b.instance, bridge)];
		const current = a.host.states.get(b.instance);
		if (!current) throw new Error("missing B state");
		const child = "version" in current ? current.version.nodes.get("child") : current.roots[0]?.children[0];
		if (!child) throw new Error("missing B child");
		child.denied = true;
		expect(b.callback("through-B")).toEqual({ status: "denied" });
		child.denied = false;
		const wire = bridge.requests.at(-1);
		if (!wire) throw new Error("missing B wire");
		const afterCapture = capture();
		expect(bridge.handle(wire, bridge.open(a.instance))).toBe('{"status":"stale"}');
		expect(capture()).toEqual(afterCapture);
		expect(bridge.handle(wire, bridge.open(b.instance))).toBe('{"status":"applied"}');
		expect(state(a.host, a.instance, bridge)).toEqual({ ...afterCapture[0], notices: afterCapture[0].notices + 1 });
		const updated = state(a.host, b.instance).rows.find((entry) => entry[2] === id(b.row.token));
		expect(updated?.[1]).toBe("child");
		expect(updated?.[7]).toBe("through-B");
		a.form.dispose();
		b.form.dispose();
	});
	it(`${name}: serialized host denials leave detached state and outgoing payload intact`, () => {
		for (const [scenario, status] of [
			["revoked", "denied"],
			["readOnly", "denied"],
			["removed", "missing"],
			["replaced", "missing"],
			["duplicate", "missing"],
			["conflict", "conflict"],
			["stale", "stale"],
			["throw", "invalid-target"],
		] as const) {
			checkDenial(factory, scenario, status);
		}
	});
	it(`${name}: test-only serialized request crosses host boundary with exact opaque row and rejects tampering`, () => {
		const { host, form, instance, row, callback, bridge } = setup(factory, true);
		if (!bridge) throw new Error("missing bridge");
		expect(callback("sent")).toEqual({ status: "applied" });
		expect(bridge.requests).toHaveLength(1);
		const wire = JSON.parse(bridge.requests[0] as string);
		expect(wire).toMatchObject({ targetKind: "row", reference: { namespace: "data", path }, value: "sent" });
		expect(wire.row).not.toBe(wire.outer);
		const updated = state(host, instance).rows.find((entry) => entry[2] === id(row.token));
		expect(updated?.[1]).toBe("child");
		expect(updated?.[7]).toBe("sent");
		const session = bridge.open(instance);
		const reject = (status: string, change: Record<string, unknown>) => {
			const before = state(host, instance, bridge);
			expect(bridge.handle(JSON.stringify({ ...wire, ...change }), session)).toBe(JSON.stringify({ status }));
			expect(state(host, instance, bridge)).toEqual(before);
		};
		reject("stale", { form: "wrong-instance" });
		reject("stale", { revision: wire.revision });
		reject("invalid-target", { row: "missing-identity" });
		reject("invalid-target", { reference: { namespace: "data", path: ["wrong"] } });
		reject("invalid-target", { reference: { namespace: "ui", path } });
		reject("invalid-target", { reference: { namespace: "data", path: [...path.slice(0, -1), "unknown"] } });
		reject("invalid-target", { reference: { namespace: "data", path: [...path, "extra"] } });
		reject("invalid-target", { value: 1 });
		reject("invalid-target", { extra: true });
		expect(bridge.handle("{", session)).toBe('{"status":"invalid-target"}');
		form.dispose();
	});
	it(`${name}: scoped WRITE evidence and typed exact field path, not a lazy read or a computation`, () => {
		const { host, form, instance, row, callback } = setup(factory);
		expect(form.checkDirectLocation(binding, " (line.quantity) ")).toMatchObject({
			ok: true,
			location: { target: ref(["quantity"], "inner"), type: { name: "string" }, range: { start: 1, end: 16 } },
		});
		const before = state(host, instance);
		for (const source of [
			"line.quantity + 'x'",
			"line?.quantity",
			"line.quantity[0]",
			"line.missing",
			"line.quantity()",
			"other.quantity",
		]) {
			expect(form.bindRowWrite(binding, source, row), source).toBeUndefined();
		}
		expect(form.writeChecked(binding, "line.quantity", "bad")).toEqual({ status: "invalid-target" });
		expect(form.bindRowWrite("root.binding", "line.quantity", row)).toBeUndefined();
		expect(state(host, instance)).toEqual(before);
		expect(callback(123)).toEqual({ status: "invalid-target" });
		expect(state(host, instance)).toEqual(before);
		form.dispose();
	});

	it(`${name}: readOnly static property cannot manufacture a scoped write`, () => {
		const host = factory();
		const readOnly = createPrivateKaladaRuntime({
			definition,
			policy,
			identity,
			strategy: host.strategy,
			directLocations: {
				[binding]: {
					line: {
						...locations[binding].line,
						properties: {
							quantity: {
								type: { kind: "primitive-type" as const, name: "string" as const },
								writable: false as never,
							},
						},
					},
				},
			},
		});
		const outer = readOnly.capture().enumerateRows("root");
		if (!outer.ok || !outer.rows[0]) throw new Error("missing outer");
		const inner = readOnly.capture().enumerateRows("root.children[0]", outer.rows[0].scope);
		if (!inner.ok || !inner.rows[0]) throw new Error("missing inner");
		expect(readOnly.checkDirectLocation(binding, "line.quantity")).toMatchObject({
			ok: false,
			diagnostics: [{ code: "KALADA_SYNTAX_WRITE_PROPERTY_INVALID" }],
		});
		expect(readOnly.bindRowWrite(binding, "line.quantity", inner.rows[0])).toBeUndefined();
		readOnly.dispose();
	});

	it(`${name}: retained handler re-resolves original nested row, never the new row at its old position`, () => {
		const { host, form, instance, row, callback } = setup(factory);
		// Reordering without a revision change is allowed by this host's explicit revision policy.
		if ("change" in host) host.states.get(instance)?.version.roots.reverse();
		else host.states.get(instance)?.roots.reverse();
		expect(callback("updated")).toEqual({ status: "applied" });
		const after = state(host, instance);
		expect(after.rows.find((entry) => entry[2] === id(row.token))?.[1]).toBe("child");
		expect(after.rows.find((entry) => entry[2] === id(row.token))?.[7]).toBe("updated");
		expect(after.rows.find((entry) => entry[0] === "second")?.[1]).toBe("second");
		expect(after.rows.find((entry) => entry[0] === "second")?.[7]).toBe("second-quantity");
		const before = state(host, instance);
		expect(callback("again")).toEqual({ status: "stale" });
		expect(state(host, instance)).toEqual(before);
		form.dispose();
	});

	it(`${name}: invocation rechecks form and row revisions, ancestry, grant and readonly`, () => {
		const test = setup(factory);
		const { host, form, instance, row, callback } = test;
		const rejected = (status: string, attempt: () => unknown) => {
			const before = state(host, instance);
			expect(attempt()).toEqual({ status });
			expect(state(host, instance)).toEqual(before);
		};
		const current = host.states.get(instance);
		if (!current) throw new Error("missing host");
		const child = "version" in current ? current.version.nodes.get("child") : current.roots[0]?.children[0];
		if (!child) throw new Error("missing child");
		child.denied = true;
		rejected("denied", () => callback("bad"));
		child.denied = false;
		child.readOnly = true;
		rejected("denied", () => callback("bad"));
		child.readOnly = false;
		child.revision = {};
		rejected("conflict", () => callback("bad"));
		child.revision = row.writeRevision as object;
		const corrupt = {
			...row,
			scope: { rows: [row.scope.rows[0], { name: "inner", token: row.scope.rows[0]?.token }] },
		};
		expect(form.bindRowWrite(binding, "line.quantity", corrupt)).toBeUndefined();
		const parent = "version" in current ? current.version.nodes.get("first") : current.roots[0];
		if (!parent) throw new Error("missing parent");
		parent.denied = true;
		rejected("denied", () => callback("bad"));
		parent.denied = false;
		if ("version" in current) current.version.roots.splice(0, 1, "second");
		else current.roots.splice(0, 1, current.roots[1] as TreeState["roots"][number]);
		rejected("missing", () => callback("bad"));
		form.dispose();
	});

	it(`${name}: retained handler rejects same-position replacement and duplicate identity without fallback`, () => {
		const { host, form, instance, callback } = setup(factory);
		const current = host.states.get(instance);
		if (!current) throw new Error("missing host");
		if ("version" in current) current.version.roots.push("first");
		else current.roots.push(current.roots[0] as TreeState["roots"][number]);
		const ambiguous = state(host, instance);
		expect(callback("forbidden")).toEqual({ status: "missing" });
		expect(state(host, instance)).toEqual(ambiguous);
		if ("version" in current) {
			current.version.roots.splice(0, 1, "replacement");
			current.version.roots.splice(current.version.roots.indexOf("first"), 1);
			current.version.nodes.set("replacement", node("replacement", "replacement"));
		} else {
			current.roots.splice(0, 1, { ...node("replacement", "replacement"), children: [] });
			current.roots.splice(
				current.roots.findIndex((item) => item.id === "first"),
				1,
			);
		}
		const replaced = state(host, instance);
		expect(callback("forbidden")).toEqual({ status: "missing" });
		expect(state(host, instance)).toEqual(replaced);
		form.dispose();
	});
}
