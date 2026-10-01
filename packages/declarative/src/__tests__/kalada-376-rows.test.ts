import { describe, expect, it } from "vitest";
import { node, serialHost } from "../../../../scripts/kalada-preflight/fixtures/row-write-hosts.js";
import { createFormRuntime, validateFormDefinition } from "../index.js";

const identity = { generation: "g1", fingerprint: "host" };
const ref = (segments: string[], scope?: string) => ({
	namespace: "data" as const,
	segments,
	...(scope ? { scope } : {}),
});
const native = "root.children[0].children[0].binding";
const custom = "root.children[0].children[1].props.edit.reference";
const target = ref(["quantity"], "inner");
const location = {
	line: {
		target: ref([], "inner"),
		type: { kind: "primitive-type" as const, name: "json" as const },
		writable: true,
		properties: { quantity: { type: { kind: "primitive-type" as const, name: "string" as const }, writable: true } },
	},
};

function installedRows() {
	const host = serialHost();
	const candidate = {
		version: 1,
		id: "row-host",
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
						{ type: "field", id: "quantity", widget: "text", binding: target },
						{
							type: "custom",
							id: "editor",
							renderer: "demo.editor",
							props: { edit: { mode: "write", reference: target } },
						},
					],
				},
			],
		},
	};
	const admission = {
		identity,
		strategy: host.strategy,
		policy: {
			...identity,
			widgets: {},
			actions: {},
			namespaces: { data: "available" },
			renderers: {
				"demo.editor": { children: "forbidden", props: { edit: { modes: ["write"], expected: "string" } } },
			},
			schema: {
				side: "input",
				availability: "complete",
				paths: [
					{ path: ["rows"], kind: "array" },
					{ path: ["rows", { row: "outer" }, "nested"], kind: "array" },
					{ path: ["rows", { row: "outer" }, "nested", { row: "inner" }, "quantity"], kind: "value" },
				],
			},
			ui: { availability: "complete", paths: [] },
		},
		writeSources: { [native]: "line.quantity", [custom]: "line.quantity" },
		directLocations: { [native]: location, [custom]: location },
	};
	const result = validateFormDefinition(candidate, admission);
	if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
	const runtime = createFormRuntime({ definition: result.value, installed: { renderers: new Set(["demo.editor"]) } });
	const instance = result.value.prepared.context.instance;
	const state = host.states.get(instance);
	if (!state) throw new Error("missing installed host instance");
	return { runtime, host, state, instance };
}

describe("#376 host-enumerated lexical rows", () => {
	it("keeps the logical token across reorder, but stale native and custom callbacks cannot retarget an index", async () => {
		const { runtime, host, state } = installedRows();
		const original = runtime.snapshot();
		const nativeControl = original.controls.find((control) => control.nodeId === "quantity");
		const customControl = original.controls.find((control) => control.nodeId === "editor");
		expect(original.rows).toHaveLength(3);
		expect(nativeControl?.value).toBe("child-quantity");
		expect(customControl?.props.edit).toBe("child-quantity");
		expect(nativeControl?.writers.value?.("native")).toEqual({ status: "applied" });
		const afterNative = runtime.snapshot();
		expect(afterNative.controls.find((control) => control.nodeId === "editor")?.props.edit).toBe("native");
		expect(afterNative.controls.find((control) => control.nodeId === "editor")?.writers.edit?.("custom")).toEqual({
			status: "applied",
		});
		const beforeMove = runtime.snapshot();
		const oldNative = beforeMove.controls.find((control) => control.nodeId === "quantity");
		const oldCustom = beforeMove.controls.find((control) => control.nodeId === "editor");
		state.roots.reverse();
		host.bump(state);
		const moved = runtime.snapshot();
		expect(moved.controls.find((control) => control.nodeId === "quantity")?.key).toBe(oldNative?.key);
		expect(moved.controls.find((control) => control.nodeId === "editor")?.key).toBe(oldCustom?.key);
		const data = moved.data;
		const notifications = host.notifications.mock.calls.length;
		expect(oldNative?.writers.value?.("stale")).toEqual({ status: "stale" });
		expect(oldCustom?.writers.edit?.("stale")).toEqual({ status: "stale" });
		expect(host.notifications).toHaveBeenCalledTimes(notifications);
		expect(runtime.snapshot().data).toEqual(data);
		expect(await runtime.submit()).toMatchObject({ status: "submitted" });
		expect(host.submissions).toEqual([data]);
		runtime.dispose();
	});

	it("denies replaced and removed child tokens, even at the old position, without mutation or outgoing data", async () => {
		const { runtime, host, state } = installedRows();
		const retained = runtime.snapshot().controls.find((control) => control.nodeId === "quantity")?.writers.value;
		const first = state.roots[0];
		if (!first) throw new Error("missing first row");
		first.children[0] = { ...node("replacement", "child"), children: [] };
		host.bump(state);
		const replaced = runtime.snapshot().data;
		const notifications = host.notifications.mock.calls.length;
		expect(retained?.("old token")).not.toEqual({ status: "applied" });
		expect(host.notifications).toHaveBeenCalledTimes(notifications);
		expect(runtime.snapshot().data).toEqual(replaced);
		const fresh = runtime.snapshot().controls.find((control) => control.nodeId === "quantity")?.writers.value;
		first.children.splice(0, 1);
		host.bump(state);
		const removed = runtime.snapshot().data;
		expect(fresh?.("removed")).not.toEqual({ status: "applied" });
		expect(runtime.snapshot().data).toEqual(removed);
		expect(await runtime.submit()).toMatchObject({ status: "submitted" });
		expect(host.submissions).toEqual([removed]);
		runtime.dispose();
	});

	it("denies a read-only row and a foreign-instance direct write without publishing a revision", () => {
		const { runtime, host, state, instance } = installedRows();
		const second = installedRows();
		const control = runtime.snapshot().controls.find((item) => item.nodeId === "quantity");
		const before = runtime.snapshot();
		const child = state.roots[0]?.children[0];
		if (!child) throw new Error("missing nested row");
		child.denied = true;
		expect(control?.writers.value?.("denied")).not.toEqual({ status: "applied" });
		expect(runtime.snapshot().data).toEqual(before.data);
		const capture = host.strategy.capture({ instance, policyGeneration: "g1", policyFingerprint: "host" });
		const outer = capture.enumerateRows?.({ rows: [] }, ref(["rows"]), "outer", 10);
		if (outer?.status !== "found" || !outer.rows[0]) throw new Error("missing enumerated row");
		const inner = capture.enumerateRows?.(outer.rows[0].scope, ref(["nested"], "outer"), "inner", 10);
		if (inner?.status !== "found" || !inner.rows[0]?.writeRevision) throw new Error("missing nested enumeration");
		expect(
			host.strategy.writeDirect?.(
				{ instance, policyGeneration: "g1", policyFingerprint: "host" },
				{
					contract: "formbar-direct-write-v1",
					targetKind: "row",
					reference: { namespace: "data", path: ["rows", { row: "outer" }, "nested", { row: "inner" }, "quantity"] },
					scope: inner.rows[0].scope,
					expectedInstance: second.instance,
					expectedRevision: state.revision,
					expectedRowRevision: inner.rows[0].writeRevision,
					value: "foreign",
				},
			),
		).not.toEqual({ status: "applied" });
		expect(runtime.snapshot().data).toEqual(before.data);
		runtime.dispose();
		second.runtime.dispose();
	});
});
