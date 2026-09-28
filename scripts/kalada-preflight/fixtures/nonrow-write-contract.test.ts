import { expect, it, vi } from "vitest";
import type { DirectWriteRequest } from "../../../packages/declarative/src/validators/kalada-data-strategy.js";
import { snapshotAdmissionPolicy } from "../../../packages/declarative/src/validators/kalada-policy.js";
import { createPrivateKaladaRuntime } from "../../../packages/declarative/src/validators/kalada-private-runtime.js";
import { nonrowPath, serialHost, versionedHost } from "./row-write-hosts.js";

const identity = { generation: "g1", fingerprint: "host" };
const definition = {
	version: 1,
	id: "form",
	root: { type: "field", id: "name", widget: "text", binding: { namespace: "data", segments: nonrowPath } },
};
const policy = snapshotAdmissionPolicy({
	...identity,
	widgets: {},
	renderers: {},
	actions: {},
	namespaces: { data: "available" },
	schema: { side: "input", availability: "complete", paths: [{ path: nonrowPath, kind: "value" }] },
	ui: { availability: "complete", paths: [] },
});
const binding = "root.binding";
type Host = ReturnType<typeof serialHost> | ReturnType<typeof versionedHost>;

function fixture(factory: () => Host) {
	const host = factory();
	const install = () => createPrivateKaladaRuntime({ definition, policy, identity, strategy: host.strategy });
	const other = install();
	const form = install();
	const [otherId, id] = [...host.states.keys()];
	if (!otherId || !id) throw new Error("missing instance");
	return { host, form, other, id, otherId };
}

function state(test: ReturnType<typeof fixture>, id = test.id) {
	const owner = test.host.states.get(id);
	if (!owner) throw new Error("missing state");
	const current = "version" in owner ? owner.version : owner;
	return {
		revision: current.revision,
		field: current.field,
		value: current.field.value,
		rows: "version" in owner ? [...owner.version.nodes.values()] : owner.roots.flatMap((row) => [row, ...row.children]),
	};
}

function unchanged(test: ReturnType<typeof fixture>, status: string, attempt: () => unknown) {
	const before = [state(test), state(test, test.otherId)];
	const calls = test.host.notifications.mock.calls.length;
	expect(attempt()).toEqual({ status });
	const after = [state(test), state(test, test.otherId)];
	for (const [index, snapshot] of before.entries()) {
		expect(after[index]?.revision).toBe(snapshot.revision);
		expect(after[index]?.field).toBe(snapshot.field);
		expect(after[index]?.value).toBe(snapshot.value);
		for (const [offset, row] of snapshot.rows.entries()) expect(after[index]?.rows[offset]).toBe(row);
	}
	expect(test.host.notifications).toHaveBeenCalledTimes(calls);
}

function direct(test: ReturnType<typeof fixture>, overrides: Partial<DirectWriteRequest> = {}) {
	const request = {
		contract: "formbar-direct-write-v1",
		targetKind: "non-repeater",
		reference: { namespace: "data", path: nonrowPath },
		scope: { rows: [] },
		expectedInstance: test.id,
		expectedRevision: state(test).revision,
		value: "edited",
		...overrides,
	} as DirectWriteRequest;
	return test.host.strategy.writeDirect?.(
		{ instance: test.id, policyGeneration: "g1", policyFingerprint: "host" },
		request,
	);
}

for (const [name, factory] of [
	["serial tree", serialHost],
	["versioned registry", versionedHost],
] as const) {
	it(`${name}: nonrepeater commits only exact target on owning form`, () => {
		const test = fixture(factory);
		const before = state(test);
		const foreign = state(test, test.otherId);
		const calls = test.host.notifications.mock.calls.length;
		expect(test.form.writeDirect(binding, undefined, "edited")).toEqual({ status: "applied" });
		expect(state(test).value).toBe("edited");
		expect(state(test).revision).not.toBe(before.revision);
		expect(state(test, test.otherId)).toEqual(foreign);
		for (const [index, row] of before.rows.entries()) expect(state(test).rows[index]).toBe(row);
		expect(test.host.notifications).toHaveBeenCalledTimes(calls + 1);
		test.form.dispose();
		test.other.dispose();
	});

	it(`${name}: invalid, stale, revoked and missing writer paths never mutate`, () => {
		const test = fixture(factory);
		const deny = (status: string, attempt: () => unknown) => unchanged(test, status, attempt);
		deny("invalid-target", () => test.form.writeDirect(binding, { token: {}, order: 0, scope: { rows: [] } }, "bad"));
		deny("invalid-target", () => test.form.writeDirect(binding, undefined, 12));
		deny("invalid-target", () => test.form.writeDirect("root.nope", undefined, "bad"));
		deny("invalid-target", () => direct(test, { scope: { rows: [{ name: "outer", token: {} }] } }));
		deny("invalid-target", () => direct(test, { expectedRowRevision: {} }));
		deny("invalid-target", () => direct(test, { reference: { namespace: "data", path: ["wrong"] } }));
		deny("invalid-target", () => direct(test, { value: 23 }));
		deny("stale", () => direct(test, { expectedRevision: {} }));
		deny("stale", () => direct(test, { expectedInstance: test.otherId }));
		deny("stale", () =>
			test.host.strategy.writeDirect?.(
				{ instance: test.otherId, policyGeneration: "g1", policyFingerprint: "host" },
				{
					contract: "formbar-direct-write-v1",
					targetKind: "non-repeater",
					reference: { namespace: "data", path: nonrowPath },
					scope: { rows: [] },
					expectedInstance: test.id,
					expectedRevision: state(test).revision,
					value: "stolen",
				},
			),
		);
		const field = state(test).field;
		field.denied = true;
		deny("denied", () => test.form.writeDirect(binding, undefined, "bad"));
		field.denied = false;
		field.readOnly = true;
		deny("denied", () => test.form.writeDirect(binding, undefined, "bad"));
		field.readOnly = false;
		field.missing = true;
		deny("missing", () => test.form.writeDirect(binding, undefined, "bad"));
		field.missing = false;
		const writer = vi.spyOn(test.host.strategy, "writeDirect").mockImplementation(() => {
			throw new Error("failed");
		});
		deny("invalid-target", () => test.form.writeDirect(binding, undefined, "bad"));
		writer.mockRestore();
		const original = test.host.strategy.writeDirect;
		Object.defineProperty(test.host.strategy, "writeDirect", { value: undefined, configurable: true });
		deny("unsupported", () => test.form.writeDirect(binding, undefined, "bad"));
		Object.defineProperty(test.host.strategy, "writeDirect", { value: original, configurable: true });
		test.form.dispose();
		deny("stale", () => test.form.writeDirect(binding, undefined, "bad"));
		test.other.dispose();
	});
}
