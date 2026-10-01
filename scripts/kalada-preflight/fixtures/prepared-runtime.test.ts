import { expect, it } from "vitest";
import { snapshotAdmissionPolicy } from "../../../packages/declarative/src/validators/kalada-policy.js";
import { prepareKaladaV1Definition } from "../../../packages/declarative/src/validators/kalada-prepared-definition.js";
import { createPreparedKaladaV1Runtime } from "../../../packages/declarative/src/validators/kalada-prepared-runtime.js";
import { quantityPath, referencePath, serialHost, versionedHost } from "./row-write-hosts.js";

const identity = { generation: "g1", fingerprint: "host" };
const ref = (segments: string[], scope?: string) => ({
	namespace: "data" as const,
	segments,
	...(scope ? { scope } : {}),
});
const expression = (value: unknown) => ({
	format: "kalada-program",
	version: 1,
	profile: "kalada-v1",
	expression: value,
});
const path = "root.children[0].children[0]";
const native = `${path}.binding`;
const customPath = "root.children[0].children[1]";
const customWrite = `${customPath}.props.edit.reference`;
const definition = {
	version: 1,
	id: "prepared-runtime",
	root: {
		type: "repeater",
		id: "outer",
		scope: "outer",
		binding: ref(["rows"]),
		children: [
			{
				type: "repeater",
				id: "inner",
				scope: "inner",
				binding: ref(["nested"], "outer"),
				children: [
					{
						type: "field",
						id: "quantity",
						widget: "text",
						binding: ref(["quantity"], "inner"),
						required: expression({ kind: "literal", value: true }),
					},
					{
						type: "custom",
						id: "editor",
						renderer: "demo.editor",
						props: {
							current: { mode: "read", expression: expression({ kind: "ref", ref: ref(["quantity"], "inner") }) },
							edit: { mode: "write", reference: ref(["quantity"], "inner") },
						},
					},
				],
			},
		],
	},
};
const policy = snapshotAdmissionPolicy({
	...identity,
	widgets: {},
	actions: {},
	namespaces: { data: "available" },
	renderers: {
		"demo.editor": {
			children: "forbidden",
			props: {
				current: { modes: ["read"], expected: "string" },
				edit: { modes: ["write"], expected: "string" },
			},
		},
	},
	schema: {
		side: "input",
		availability: "complete",
		paths: [
			{ path: ["rows"], kind: "array" },
			{ path: ["rows", { row: "outer" }, "nested"], kind: "array" },
			{ path: quantityPath, kind: "value" },
			{ path: referencePath, kind: "value" },
			{ path: [...quantityPath.slice(0, -1), "lock"], kind: "value" },
		],
	},
	ui: { availability: "complete", paths: [] },
});
const location = {
	line: {
		target: ref([], "inner"),
		type: { kind: "primitive-type" as const, name: "json" as const },
		writable: true as const,
		properties: {
			quantity: { type: { kind: "primitive-type" as const, name: "string" as const }, writable: true as const },
		},
	},
};

function start(host: ReturnType<typeof serialHost> | ReturnType<typeof versionedHost>, changed: object = {}) {
	const prepared = prepareKaladaV1Definition({
		definition,
		policy,
		identity,
		strategy: host.strategy,
		writeSources: { [native]: "line.quantity", [customWrite]: "line.quantity" },
		directLocations: { [native]: location, [customWrite]: location },
		...changed,
	});
	return { prepared, runtime: createPreparedKaladaV1Runtime(prepared, { renderers: new Set(["demo.editor"]) }) };
}

it("fails closed before subscribing or capturing when a trusted custom renderer is absent", () => {
	const host = serialHost();
	const { prepared, runtime } = start(host);
	runtime.dispose();
	expect(() => createPreparedKaladaV1Runtime(prepared)).toThrow(`${customPath}.renderer: MISSING_RENDERER`);
});

it("denies retained writers on same-revision host revocation, removed rows and cross-form reuse", () => {
	const host = serialHost();
	const a = start(host);
	const b = start(host);
	const state = host.states.get(a.prepared.context.instance);
	const other = host.states.get(b.prepared.context.instance);
	if (!state || !other) throw new Error("missing host instance");
	const callback = a.runtime.snapshot().controls.find((control) => control.nodeId === "quantity")?.writers.value;
	state.roots[0].children[0].readOnly = true;
	expect(callback?.("denied")).not.toEqual({ status: "applied" });
	expect(other.roots[0].children[0].quantity).toBe("child-quantity");
	state.roots[0].children[0].readOnly = false;
	state.roots[0].children.splice(0, 1);
	host.bump(state);
	expect(callback?.("removed")).not.toEqual({ status: "applied" });
	expect(a.runtime.snapshot().controls).toHaveLength(0);
	expect(b.runtime.snapshot().controls.find((control) => control.nodeId === "quantity")?.value).toBe("child-quantity");
	a.runtime.dispose();
	expect(callback?.("disposed")).not.toEqual({ status: "applied" });
	b.runtime.dispose();
});

it("rechecks current strict Boolean guards at invocation even without a notification", () => {
	const host = serialHost();
	let lock: unknown = false;
	const strategy = {
		...host.strategy,
		capture(context: Parameters<typeof host.strategy.capture>[0]) {
			const frame = host.strategy.capture(context);
			return {
				...frame,
				read(reference: Parameters<typeof frame.read>[0], scope: Parameters<typeof frame.read>[1]) {
					return reference.path.at(-1) === "lock"
						? { status: "found" as const, value: lock as never }
						: frame.read(reference, scope);
				},
			};
		},
	};
	const guarded = {
		...definition,
		root: {
			...definition.root,
			children: definition.root.children.map((repeater) => ({
				...repeater,
				children: repeater.children.map((node, index) =>
					index === 0 ? { ...node, disabled: expression({ kind: "ref", ref: ref(["lock"], "inner") }) } : node,
				),
			})),
		},
	};
	const { prepared, runtime } = start(host, { strategy, definition: guarded });
	const callback = runtime.snapshot().controls.find((control) => control.nodeId === "quantity")?.writers.value;
	const state = host.states.get(prepared.context.instance);
	if (!state) throw new Error("missing host instance");
	for (const rejected of [true, "no", null]) {
		lock = rejected;
		expect(callback?.("blocked")).not.toEqual({ status: "applied" });
		expect(state.roots[0].children[0].quantity).toBe("child-quantity");
	}
	lock = false;
	expect(callback?.("permitted")).toEqual({ status: "applied" });
	runtime.dispose();
});

it("rejects wrong Boolean, non-JSON native reads and missing capability without falling back to another data source", () => {
	const host = serialHost();
	const invalid = {
		...definition,
		root: {
			...definition.root,
			children: definition.root.children.map((repeater) => ({
				...repeater,
				children: repeater.children.map((node, index) =>
					index === 0 ? { ...node, required: expression({ kind: "literal", value: "not Boolean" }) } : node,
				),
			})),
		},
	};
	const wrong = start(host, { definition: invalid });
	expect(() => wrong.runtime.snapshot()).toThrow(`${native.replace(".binding", ".required")}: BOOLEAN_REQUIRED`);
	wrong.runtime.dispose();
	const strategy = {
		...host.strategy,
		capture(context: Parameters<typeof host.strategy.capture>[0]) {
			const frame = host.strategy.capture(context);
			return {
				...frame,
				read(reference: Parameters<typeof frame.read>[0], scope: Parameters<typeof frame.read>[1]) {
					return reference.path.at(-1) === "quantity"
						? { status: "found" as const, value: (() => 1) as never }
						: frame.read(reference, scope);
				},
			};
		},
	};
	const malformed = start(host, { strategy });
	expect(() => malformed.runtime.snapshot()).toThrow(`${native}: NON_JSON_RESULT`);
	malformed.runtime.dispose();
	const denied = start(host, {
		strategy: {
			...host.strategy,
			capture(context: Parameters<typeof host.strategy.capture>[0]) {
				const frame = host.strategy.capture(context);
				return {
					...frame,
					read(reference: Parameters<typeof frame.read>[0], scope: Parameters<typeof frame.read>[1]) {
						return reference.path.at(-1) === "quantity" ? { status: "denied" as const } : frame.read(reference, scope);
					},
				};
			},
		},
	});
	expect(() => denied.runtime.snapshot()).toThrow(`${native}: TARGET_DENIED`);
	denied.runtime.dispose();
});

it("retains computations as a static graph without executing their lazy reads or writing back", () => {
	const host = serialHost();
	const source = ["profile", "source"];
	const target = ["profile", "derived"];
	const guarded = {
		...definition,
		computations: [{ id: "unused", target: ref(target), expression: expression({ kind: "ref", ref: ref(source) }) }],
	};
	const strategy = {
		...host.strategy,
		capture(context: Parameters<typeof host.strategy.capture>[0]) {
			const frame = host.strategy.capture(context);
			return {
				...frame,
				read(reference: Parameters<typeof frame.read>[0], scope: Parameters<typeof frame.read>[1]) {
					if (reference.path.at(-1) === "source") throw new Error("computation must not execute");
					return frame.read(reference, scope);
				},
			};
		},
	};
	const attested = snapshotAdmissionPolicy({
		...policy,
		schema: {
			...policy.schema,
			paths: [...policy.schema.paths, { path: source, kind: "value" }, { path: target, kind: "value" }],
		},
	});
	const { prepared, runtime } = start(host, { definition: guarded, strategy, policy: attested });
	expect(runtime.snapshot().controls.find((control) => control.nodeId === "quantity")?.value).toBe("child-quantity");
	expect(host.states.get(prepared.context.instance)?.roots[0].children[0].quantity).toBe("child-quantity");
	runtime.dispose();
});

for (const [name, hostFactory] of [
	["mutable-tree", serialHost],
	["versioned-registry", versionedHost],
] as const) {
	it(`${name}: same strategy frame yields native/custom values, stable row keys, guarded writes and outgoing data`, async () => {
		const host = hostFactory();
		const { prepared, runtime } = start(host);
		const first = runtime.snapshot();
		const nativeControl = first.controls.find((control) => control.nodeId === "quantity");
		const customControl = first.controls.find((control) => control.nodeId === "editor");
		expect(nativeControl?.value).toBe("child-quantity");
		expect(nativeControl?.required).toBe(true);
		expect(customControl?.props.current).toBe("child-quantity");
		expect(customControl?.props.edit).toBe("child-quantity");
		expect(JSON.stringify(customControl?.props)).not.toContain("onChange");
		const old = nativeControl?.writers.value;
		expect(old?.("changed")).toEqual({ status: "applied" });
		expect(old?.("stale")).not.toEqual({ status: "applied" });
		const updated = runtime.snapshot();
		expect(updated.controls.find((control) => control.nodeId === "editor")?.props.current).toBe("changed");
		expect(updated.data).toEqual(expect.objectContaining({ rows: expect.any(Array) }));
		const current = updated.controls.find((control) => control.nodeId === "editor");
		expect(current?.writers.edit?.("custom-write")).toEqual({ status: "applied" });
		expect((await runtime.submit()).status).toBe("submitted");
		if ("change" in host) host.change(prepared.context.instance, (draft) => draft.roots.reverse());
		else {
			const state = host.states.get(prepared.context.instance);
			if (!state) throw new Error("missing host instance");
			state.roots.reverse();
			host.bump(state);
		}
		const moved = runtime.snapshot();
		expect(moved.controls.find((control) => control.nodeId === "quantity")?.key).toBe(nativeControl?.key);
		expect(moved.rows.map((row) => row.order)).toEqual([0, 1, 0]);
		expect(current?.writers.edit?.("stale")).not.toEqual({ status: "applied" });
		runtime.dispose();
	});
}
