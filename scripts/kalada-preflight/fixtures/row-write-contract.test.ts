import { expect, it, vi } from "vitest";
import type {
	DirectWriteRequest,
	EnumeratedRow,
	FormbarDataStrategyV1,
} from "../../../packages/declarative/src/validators/kalada-data-strategy.js";
import { snapshotAdmissionPolicy } from "../../../packages/declarative/src/validators/kalada-policy.js";
import { createPrivateKaladaRuntime } from "../../../packages/declarative/src/validators/kalada-private-runtime.js";
import {
	type RegistryState,
	type TreeState,
	node,
	referencePath,
	serialHost,
	versionedHost,
} from "./row-write-hosts.js";

const identity = { generation: "g1", fingerprint: "host" };
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
				children: [{ type: "field", id: "editable", widget: "text", binding: ref(["value"], "inner") }],
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
			{ path: ["rows"], kind: "array" },
			{ path: ["rows", { row: "outer" }, "nested"], kind: "array" },
			{ path: referencePath, kind: "value" },
		],
	},
	ui: { availability: "complete", paths: [] },
});
const binding = "root.children[0].children[0].binding";
const install = (strategy: FormbarDataStrategyV1) =>
	createPrivateKaladaRuntime({ definition, policy, identity, strategy });

type Host = ReturnType<typeof serialHost> | ReturnType<typeof versionedHost>;
function view(host: Host, instance: object) {
	const state = host.states.get(instance);
	if (!state) throw new Error("unknown instance");
	if ("version" in state) {
		const { version } = state;
		return {
			state,
			revision: version.revision,
			version,
			roots: [...version.roots],
			rows: [...version.nodes].map(([id, item]) => [
				id,
				item,
				item.value,
				item.revision,
				item.token,
				[...item.children],
				item.denied,
				item.readOnly,
			]),
		};
	}
	return {
		state,
		revision: state.revision,
		roots: [...state.roots],
		rows: state.roots
			.flatMap((item) => [item, ...item.children])
			.map((item) => [item, item.value, item.revision, item.token, [...item.children], item.denied, item.readOnly]),
	};
}

function selected(form: ReturnType<typeof install>, firstToken?: object): EnumeratedRow {
	const outer = form.capture().enumerateRows("root");
	if (!outer.ok) throw new Error(outer.code);
	const parent = firstToken ? outer.rows.find((row) => row.token === firstToken) : outer.rows[0];
	const inner = form.capture().enumerateRows("root.children[0]", parent?.scope);
	if (!inner.ok || !inner.rows[0]) throw new Error("missing nested row");
	return inner.rows[0];
}

function fixture(factory: () => Host) {
	const host = factory();
	const other = install(host.strategy);
	const form = install(host.strategy);
	const [otherId, id] = [...host.states.keys()];
	if (!otherId || !id) throw new Error("missing instances");
	return { host, other, form, otherId, id, row: selected(form) };
}

function denyWithoutMutation(test: ReturnType<typeof fixture>, expected: string, attempt: () => unknown) {
	const before = [view(test.host, test.id), view(test.host, test.otherId)];
	const calls = test.host.notifications.mock.calls.length;
	expect(attempt()).toEqual({ status: expected });
	const after = [view(test.host, test.id), view(test.host, test.otherId)];
	expect(after).toEqual(before);
	for (const [index, snapshot] of before.entries()) {
		const current = after[index];
		if (!current) throw new Error("missing instance snapshot");
		expect(current.rows).toHaveLength(snapshot.rows.length);
		for (const [rowIndex, entry] of snapshot.rows.entries()) {
			const row = current.rows[rowIndex];
			expect(row?.["version" in snapshot ? 1 : 0]).toBe(entry["version" in snapshot ? 1 : 0]);
		}
	}
	expect(test.host.notifications).toHaveBeenCalledTimes(calls);
}

function direct(test: ReturnType<typeof fixture>, overrides: Partial<DirectWriteRequest> = {}) {
	const state = view(test.host, test.id);
	return test.host.strategy.writeDirect?.(
		{ instance: test.id, policyGeneration: "g1", policyFingerprint: "host" },
		{
			contract: "formbar-direct-write-v1",
			reference: { namespace: "data", path: referencePath },
			scope: test.row.scope,
			expectedInstance: test.id,
			expectedRevision: state.revision,
			expectedRowRevision: test.row.writeRevision as object,
			value: "edited",
			...overrides,
		},
	);
}

for (const [name, factory] of [
	["serial tree", serialHost],
	["versioned registry", versionedHost],
] as const) {
	it(`${name}: equal-valued row replacement is detected even when values and revisions match`, () => {
		const test = fixture(factory);
		expect(() =>
			denyWithoutMutation(test, "invalid-target", () => {
				const result = test.form.writeDirect(binding, test.row, 123);
				if ("change" in test.host) {
					const first = test.host.states.get(test.id)?.version.nodes.get("first");
					if (!first) throw new Error("missing first row");
					test.host.states.get(test.id)?.version.nodes.set("first", { ...first });
				} else {
					const state = test.host.states.get(test.id);
					if (!state?.roots[0]) throw new Error("missing first row");
					state.roots[0] = { ...state.roots[0] };
				}
				return result;
			}),
		).toThrow(/toBe/);
		test.other.dispose();
		test.form.dispose();
	});

	it(`${name}: surviving nested alias selects exact row after reorder; commit changes only that row`, () => {
		const test = fixture(factory);
		const { host, id, form, row } = test;
		const original = view(host, id);
		if ("change" in host) host.change(id, (draft) => draft.roots.reverse());
		else {
			const state = host.states.get(id) as TreeState;
			state.roots.reverse();
			host.bump(state);
		}
		const reordered = selected(form, row.scope.rows[0]?.token);
		expect(reordered.token).toBe(row.token);
		const before = view(host, id);
		expect(form.writeDirect(binding, reordered, "edited")).toEqual({ status: "applied" });
		const after = view(host, id);
		expect(after.revision).not.toBe(before.revision);
		expect(selected(form, row.scope.rows[0]?.token).token).toBe(row.token);
		if ("change" in host) {
			expect((before.version as RegistryState["version"]).nodes.get("child")?.value).toBe("child");
			expect((before.version as RegistryState["version"]).nodes.get("child")?.revision).toBe(reordered.writeRevision);
			expect(before.rows[2]?.[2]).toBe("child");
			expect((after.state as RegistryState).version).not.toBe(before.version);
		} else expect(before.rows[2]?.[1]).toBe("child");
		expect(after.rows.some((entry) => entry.includes("edited"))).toBe(true);
		expect(original.rows.some((entry) => entry.includes("second"))).toBe(true);
		denyWithoutMutation(test, "conflict", () => form.writeDirect(binding, reordered, "lost concurrent write"));
		test.other.dispose();
		form.dispose();
	});

	it(`${name}: every client and host rejection leaves both forms and all revisions untouched`, () => {
		const test = fixture(factory);
		const { host, form, other, id, otherId, row } = test;
		const denied = (status: string, attempt: () => unknown) => denyWithoutMutation(test, status, attempt);
		denied("missing", () => other.writeDirect(binding, row, "stolen"));
		denied("stale", () => direct(test, { expectedInstance: otherId }));
		denied("stale", () =>
			host.strategy.writeDirect?.(
				{ instance: otherId, policyGeneration: "g1", policyFingerprint: "host" },
				{
					contract: "formbar-direct-write-v1",
					reference: { namespace: "data", path: referencePath },
					scope: row.scope,
					expectedInstance: id,
					expectedRevision: view(host, id).revision,
					expectedRowRevision: row.writeRevision as object,
					value: "stolen",
				},
			),
		);
		denied("invalid-target", () => form.writeDirect(binding, row, 123));
		denied("invalid-target", () => form.writeDirect("root.binding", row, "bad"));
		denied("invalid-target", () => direct(test, { reference: { namespace: "data", path: ["wrong"] } }));
		denied("conflict", () => direct(test, { expectedRowRevision: {} }));
		denied("stale", () => direct(test, { expectedRevision: {} }));
		const writer = vi.spyOn(host.strategy, "writeDirect");
		writer.mockImplementation(() => {
			throw new Error("writer failed");
		});
		denied("invalid-target", () => form.writeDirect(binding, row, "throw"));
		writer.mockRestore();
		const original = host.strategy.writeDirect;
		Object.defineProperty(host.strategy, "writeDirect", { value: undefined, configurable: true });
		denied("unsupported", () => form.writeDirect(binding, row, "unsupported"));
		Object.defineProperty(host.strategy, "writeDirect", { value: original, configurable: true });
		other.dispose();
		form.dispose();
	});

	it(`${name}: grant revocation, readOnly, removal, replacement and duplicate identity fail closed`, () => {
		const test = fixture(factory);
		const { host, id, form, row } = test;
		const edit = (fn: (item: { denied: boolean; readOnly: boolean; revision: object }) => void) => {
			if ("change" in host)
				host.change(id, (draft) => {
					const child = draft.nodes.get("child");
					if (!child) throw new Error("missing child");
					fn(child);
				});
			else {
				const state = host.states.get(id) as TreeState;
				const child = state.roots[0]?.children[0];
				if (!child) throw new Error("missing child");
				fn(child);
				host.bump(state);
			}
		};
		edit((item) => {
			item.denied = true;
		}); // grant revoked after the row was captured
		denyWithoutMutation(test, "denied", () => form.writeDirect(binding, row, "revoked"));
		edit((item) => {
			item.denied = false;
			item.readOnly = true;
		});
		denyWithoutMutation(test, "denied", () => form.writeDirect(binding, selected(form), "readonly"));
		edit((item) => {
			item.readOnly = false;
			item.revision = {};
		});
		denyWithoutMutation(test, "conflict", () => form.writeDirect(binding, row, "conflict"));
		if ("change" in host) host.change(id, (draft) => draft.roots.splice(0, 1));
		else {
			const state = host.states.get(id) as TreeState;
			state.roots.splice(0, 1);
			host.bump(state);
		}
		denyWithoutMutation(test, "missing", () => form.writeDirect(binding, row, "removed"));
		if ("change" in host)
			host.change(id, (draft) => {
				draft.roots.unshift("replacement");
				draft.nodes.set("replacement", node("replacement", "replacement"));
			});
		else {
			const state = host.states.get(id) as TreeState;
			state.roots.unshift({ ...node("replacement", "replacement"), children: [] });
			host.bump(state);
		}
		denyWithoutMutation(test, "missing", () => form.writeDirect(binding, row, "replaced"));
		test.other.dispose();
		form.dispose();
	});

	it(`${name}: ambiguous identity cannot be used as a position`, () => {
		const test = fixture(factory);
		const { host, id, form, row } = test;
		if ("change" in host) host.change(id, (draft) => draft.roots.push("first"));
		else {
			const state = host.states.get(id) as TreeState;
			state.roots.push(state.roots[0] as TreeState["roots"][number]);
			host.bump(state);
		}
		denyWithoutMutation(test, "missing", () => form.writeDirect(binding, row, "ambiguous"));
		test.other.dispose();
		form.dispose();
	});
}
