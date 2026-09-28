import { expect, it } from "vitest";
import { snapshotAdmissionPolicy } from "../../../packages/declarative/src/validators/kalada-policy.js";
import { createPrivateKaladaRuntime } from "../../../packages/declarative/src/validators/kalada-private-runtime.js";
import { nonrowPath, referencePath, serialHost, versionedHost } from "./row-write-hosts.js";

const identity = { generation: "g1", fingerprint: "host" };
const definition = {
	version: 1,
	id: "form",
	root: {
		type: "group",
		id: "both",
		children: [
			{ type: "field", id: "name", widget: "text", binding: { namespace: "data", segments: nonrowPath } },
			{
				type: "repeater",
				id: "list",
				scope: "outer",
				binding: { namespace: "data", segments: ["rows"] },
				children: [
					{
						type: "repeater",
						id: "nested",
						scope: "inner",
						binding: { namespace: "data", segments: ["nested"], scope: "outer" },
						children: [
							{
								type: "field",
								id: "value",
								widget: "text",
								binding: { namespace: "data", segments: ["value"], scope: "inner" },
							},
						],
					},
				],
			},
		],
	},
};
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
			{ path: nonrowPath, kind: "value" },
			{ path: ["rows"], kind: "array" },
			{ path: ["rows", { row: "outer" }, "nested"], kind: "array" },
			{ path: referencePath, kind: "value" },
		],
	},
	ui: { availability: "complete", paths: [] },
});
const field = "root.children[0].binding";
const rowField = "root.children[1].children[0].children[0].binding";

for (const [name, factory] of [
	["serial tree", serialHost],
	["versioned registry", versionedHost],
] as const) {
	const setup = () => {
		const host = factory();
		const form = createPrivateKaladaRuntime({ definition, policy, identity, strategy: host.strategy });
		const id = [...host.states.keys()][0];
		if (!id) throw new Error("missing form");
		const current = () => {
			const owner = host.states.get(id);
			if (!owner) throw new Error("missing owner");
			const version = "version" in owner ? owner.version : owner;
			const child = "nodes" in version ? version.nodes.get("child") : version.roots[0]?.children[0];
			if (!child) throw new Error("missing child");
			return { revision: version.revision, field: version.field, child, rowRevision: child.revision };
		};
		const selected = () => {
			const outer = form.capture().enumerateRows("root.children[1]");
			if (!outer.ok) throw new Error(outer.code);
			const inner = form.capture().enumerateRows("root.children[1].children[0]", outer.rows[0]?.scope);
			if (!inner.ok || !inner.rows[0]) throw new Error("missing inner row");
			return inner.rows[0];
		};
		const reads = (scope: ReturnType<typeof selected>["scope"], value: string, rowValue: string) => {
			const frame = host.strategy.capture({ instance: id, policyGeneration: "g1", policyFingerprint: "host" });
			expect(frame.read({ namespace: "data", path: nonrowPath }, { rows: [] })).toEqual({ status: "found", value });
			expect(frame.read({ namespace: "data", path: referencePath }, scope)).toEqual({
				status: "found",
				value: rowValue,
			});
		};
		return { host, form, id, current, selected, reads };
	};
	it(`${name}: interleaved row and nonrow writes preserve both targets and reject stale attempts`, () => {
		const { host, form, id, current, selected, reads } = setup();
		const initial = current();
		const firstRow = selected();
		const oldFrame = host.strategy.capture({ instance: id, policyGeneration: "g1", policyFingerprint: "host" });
		reads(firstRow.scope, "original", "child");
		let calls = host.notifications.mock.calls.length;
		expect(form.writeDirect(rowField, firstRow, "row-one")).toEqual({ status: "applied" });
		const afterRow = current();
		expect(afterRow.revision).not.toBe(initial.revision);
		expect(afterRow.rowRevision).not.toBe(initial.rowRevision);
		expect(afterRow.field).toBe(initial.field);
		expect(host.notifications).toHaveBeenCalledTimes(++calls);
		expect(oldFrame.read({ namespace: "data", path: nonrowPath }, { rows: [] })).toEqual({ status: "stale" });
		reads(firstRow.scope, "original", "row-one");
		expect(form.writeDirect(rowField, firstRow, "stale row")).toEqual({ status: "conflict" });
		expect(current()).toEqual(afterRow);
		expect(host.notifications).toHaveBeenCalledTimes(calls);
		expect(form.writeDirect(field, undefined, "nonrow-one")).toEqual({ status: "applied" });
		const afterField = current();
		expect(afterField.revision).not.toBe(afterRow.revision);
		expect(afterField.rowRevision).toBe(afterRow.rowRevision);
		expect(afterField.child).toBe(afterRow.child);
		expect(afterField.field.value).toBe("nonrow-one");
		expect(host.notifications).toHaveBeenCalledTimes(++calls);
		reads(firstRow.scope, "nonrow-one", "row-one");
		const nextRow = selected();
		expect(nextRow.token).toBe(firstRow.token);
		expect(form.writeDirect(rowField, nextRow, "row-two")).toEqual({ status: "applied" });
		const afterSecondRow = current();
		expect(afterSecondRow.field).toBe(afterField.field);
		expect(afterSecondRow.rowRevision).not.toBe(afterField.rowRevision);
		expect(afterSecondRow.revision).not.toBe(afterField.revision);
		expect(host.notifications).toHaveBeenCalledTimes(++calls);
		reads(nextRow.scope, "nonrow-one", "row-two");
		expect(form.writeDirect(field, undefined, 42)).toEqual({ status: "invalid-target" });
		expect(current()).toEqual(afterSecondRow);
		expect(host.notifications).toHaveBeenCalledTimes(calls);
		expect(form.writeDirect(rowField, nextRow, "stale row again")).toEqual({ status: "conflict" });
		expect(current()).toEqual(afterSecondRow);
		expect(host.notifications).toHaveBeenCalledTimes(calls);
		form.dispose();
	});
}
