import { expect, it, vi } from "vitest";
import type {
	DataContext,
	DataFrame,
	FormbarDataStrategyV1,
	ReadScope,
	RowEnumeration,
} from "../../../packages/declarative/src/validators/kalada-data-strategy.js";
import { snapshotAdmissionPolicy } from "../../../packages/declarative/src/validators/kalada-policy.js";
import {
	KALADA_RUNTIME_ARTIFACT,
	createPrivateKaladaRuntime,
} from "../../../packages/declarative/src/validators/kalada-private-runtime.js";

const identity = { generation: "g1", fingerprint: "host" };
const thenKey = "then";
const ref = (segments: string[], scope?: string) => ({ namespace: "data", segments, ...(scope ? { scope } : {}) });
const program = (expression: unknown) => ({ format: "kalada-program", version: 1, profile: "kalada-v1", expression });
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
			{ path: ["rows", { row: "outer" }, "nested", { row: "inner" }, "value"], kind: "value" },
			{ path: ["rows", { row: "outer" }, "nested", { row: "inner" }, "unused"], kind: "value" },
		],
	},
	ui: { availability: "complete", paths: [] },
});
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
				children: [{ type: "output", id: "out", value: program({ kind: "ref", ref: ref(["value"], "inner") }) }],
			},
		],
	},
};
const slot = "root.children[0].children[0].value";
const installed = (strategy: FormbarDataStrategyV1, source: unknown = definition) =>
	createPrivateKaladaRuntime({ definition: source, policy, identity, strategy });
const receipt = () => ({ artifact: KALADA_RUNTIME_ARTIFACT, policyGeneration: "g1", policyFingerprint: "host" });
type Item = { token: object; value: string; nested: Item[] };
const row = (value: string): Item => ({ token: {}, value, nested: [] });
const descriptors = (source: Item[], parent: ReadScope, name: string) =>
	source.map((item, order) => ({
		token: item.token,
		order,
		scope: { rows: [...parent.rows, { name, token: item.token }] },
	}));
type SnapshotState = { revision: object; rows: Item[]; notify: () => void };
function changeSnapshot(states: Map<object, SnapshotState>, instance: object, fn: (rows: Item[]) => void) {
	const entry = states.get(instance);
	if (!entry) throw new Error("unknown form");
	fn(entry.rows);
	entry.revision = {};
	entry.notify();
}

function snapshotFrame(
	context: DataContext,
	entry: SnapshotState,
	reads: ReturnType<typeof vi.fn>,
	enumerate: ReturnType<typeof vi.fn>,
	onEnumerate: () => void,
): DataFrame {
	const token = entry.revision;
	const copy = entry.rows.map((item) => ({ ...item, nested: [...item.nested] }));
	const get = (scope: ReadScope) => copy.find((item) => item.token === scope.rows[0]?.token);
	return {
		instance: context.instance,
		token,
		enumerateRows(parent, binding, name, capacity) {
			enumerate(parent, binding, name, capacity);
			const source = name === "outer" ? copy : get(parent)?.nested;
			onEnumerate();
			if (entry.revision !== token) return { status: "stale" };
			if (!source) return { status: "denied" };
			if (source.length > capacity) return { status: "capacity" };
			return { status: "found", rows: descriptors(source, parent, name) };
		},
		read(_binding, scope) {
			reads(_binding, scope);
			if (entry.revision !== token) return { status: "stale" };
			const item = get(scope)?.nested.find((child) => child.token === scope.rows[1]?.token);
			return item ? { status: "found", value: item.value } : { status: "denied" };
		},
	};
}

// Host A snapshots a per-form tree at capture, while retaining logical row objects across captures.
function snapshotHost() {
	const states = new Map<object, SnapshotState>();
	const reads = vi.fn();
	const enumerate = vi.fn();
	let stolen: DataFrame | undefined;
	let during = () => {};
	const state = (context: DataContext) => {
		const entry = states.get(context.instance);
		if (!entry) throw new Error("foreign form");
		return entry;
	};
	const strategy: FormbarDataStrategyV1 = {
		contract: "formbar-data-strategy-v1",
		identity(context) {
			if (!states.has(context.instance))
				states.set(context.instance, { revision: {}, rows: [row("A"), row("B")], notify: () => {} });
			return receipt();
		},
		capture(context) {
			if (stolen) {
				const old = stolen;
				stolen = undefined;
				return old;
			}
			return snapshotFrame(context, state(context), reads, enumerate, () => during());
		},
		current: (context) => state(context).revision,
		subscribe(context, notify) {
			state(context).notify = notify;
			return () => {
				state(context).notify = () => {};
			};
		},
	};
	return {
		strategy,
		states,
		reads,
		enumerate,
		steal: (frame: DataFrame) => {
			stolen = frame;
		},
		on: (fn: () => void) => {
			during = fn;
		},
		change(instance: object, fn: (rows: Item[]) => void) {
			changeSnapshot(states, instance, fn);
		},
	};
}

type RegistryState = { revision: object; ids: string[]; byId: Map<string, Item>; notify: () => void };
function seedRegistry(host: ReturnType<typeof registryHost>, id: object) {
	const first = host.entries.get(id)?.byId.get("key") as Item;
	const second = row("second");
	first.nested.push(row("child"));
	second.nested.push(row("other child"));
	host.change(id, (entry) => {
		entry.ids.push("second");
		entry.byId.set("second", second);
	});
	return { first, second };
}

function registryFrame(context: DataContext, state: RegistryState, reads: ReturnType<typeof vi.fn>): DataFrame {
	const token = state.revision;
	return {
		token,
		instance: context.instance,
		enumerateRows(parent, _binding, name, capacity): RowEnumeration {
			if (state.revision !== token) return { status: "stale" };
			const parents = [...state.byId.values()];
			const source =
				name === "outer"
					? state.ids.map((id) => state.byId.get(id) as Item)
					: parents.find((candidate) => candidate.token === parent.rows[0]?.token)?.nested;
			if (!source) return { status: "denied" };
			if (source.length > capacity) return { status: "capacity" };
			return { status: "found", rows: descriptors(source, parent, name) };
		},
		read(_binding, scope) {
			reads(_binding, scope);
			if (state.revision !== token) return { status: "stale" };
			const parent = [...state.byId.values()].find((value) => value.token === scope.rows[0]?.token);
			const child = parent?.nested.find((value) => value.token === scope.rows[1]?.token);
			return child ? { status: "found", value: child.value } : { status: "denied" };
		},
	};
}

// Host B resolves a keyed registry live, rather than snapshotting a tree.
function registryHost() {
	const entries = new Map<object, RegistryState>();
	const reads = vi.fn();
	const entry = (context: DataContext) => {
		const found = entries.get(context.instance);
		if (!found) throw new Error("foreign form");
		return found;
	};
	const strategy: FormbarDataStrategyV1 = {
		contract: "formbar-data-strategy-v1",
		identity(context) {
			if (!entries.has(context.instance))
				entries.set(context.instance, {
					revision: {},
					ids: ["key"],
					byId: new Map([["key", row("registry")]]),
					notify: () => {},
				});
			return receipt();
		},
		capture(context) {
			return registryFrame(context, entry(context), reads);
		},
		current: (context) => entry(context).revision,
		subscribe(context, notify) {
			entry(context).notify = notify;
			return () => {
				entry(context).notify = () => {};
			};
		},
	};
	return {
		strategy,
		entries,
		reads,
		change(instance: object, fn: (state: RegistryState) => void) {
			const state = entries.get(instance);
			if (!state) throw new Error("unknown form");
			fn(state);
			state.revision = {};
			state.notify();
		},
	};
}

it("keeps stable logical identities across reordered captures; replacement cannot inherit removed state", () => {
	const host = snapshotHost();
	const instance = installed(host.strategy);
	const id = [...host.states.keys()][0] as object;
	const [alpha, beta] = host.states.get(id)?.rows as Item[];
	alpha.nested.push(row("child"));
	const frame = instance.capture();
	const outer = frame.enumerateRows("root", { rows: [] }, 2);
	if (!outer.ok) throw new Error(outer.code);
	expect(outer.rows.map((item) => item.token)).toEqual([alpha.token, beta.token]);
	expect(host.reads).not.toHaveBeenCalled();
	const inner = frame.enumerateRows("root.children[0]", outer.rows[0]?.scope, 2);
	if (!inner.ok) throw new Error(inner.code);
	expect(inner.rows[0]?.scope.rows.map((item) => item.name)).toEqual(["outer", "inner"]);
	expect(frame.evaluate(slot, inner.rows[0]?.scope)).toEqual({ ok: true, value: "child" });
	host.change(id, (rows) => rows.reverse());
	expect(frame.evaluate(slot, inner.rows[0]?.scope)).toEqual({ ok: false, path: slot, code: "STALE_CAPTURE" });
	const reordered = instance.capture().enumerateRows("root", { rows: [] }, 2);
	expect(reordered.ok && reordered.rows.map((item) => item.token)).toEqual([beta.token, alpha.token]);
	host.change(id, (rows) => {
		rows.splice(1, 1, row("replacement"));
	});
	const replaced = instance.capture().enumerateRows("root", { rows: [] }, 2);
	expect(replaced.ok && replaced.rows[1]?.token).not.toBe(alpha.token);
	expect(instance.capture().evaluate(slot, inner.rows[0]?.scope)).toMatchObject({ ok: false });
	instance.dispose();
});

it("registry-host nested aliases survive reorder but not removal or replacement across captures", () => {
	const host = registryHost();
	const instance = installed(host.strategy);
	const separate = installed(host.strategy);
	const id = [...host.entries.keys()][0] as object;
	const { first, second } = seedRegistry(host, id);
	const capture = instance.capture();
	const outer = capture.enumerateRows("root");
	if (!outer.ok) throw new Error(outer.code);
	const nested = capture.enumerateRows("root.children[0]", outer.rows[0]?.scope);
	if (!nested.ok) throw new Error(nested.code);
	const scope = nested.rows[0]?.scope as ReadScope;
	expect(scope.rows.map((binding) => binding.name)).toEqual(["outer", "inner"]);
	expect(capture.evaluate(slot, scope)).toEqual({ ok: true, value: "child" });
	expect(host.reads).toHaveBeenCalledTimes(1);
	host.change(id, (entry) => entry.ids.reverse());
	expect(capture.evaluate(slot, scope)).toEqual({ ok: false, path: slot, code: "STALE_CAPTURE" });
	const reordered = instance.capture().enumerateRows("root");
	expect(reordered.ok && reordered.rows.map((item) => item.token)).toEqual([second.token, first.token]);
	expect(instance.capture().evaluate(slot, scope)).toEqual({ ok: true, value: "child" });
	host.change(id, (entry) => {
		entry.ids.splice(entry.ids.indexOf("key"), 1);
		entry.byId.delete("key");
	});
	expect(instance.capture().evaluate(slot, scope)).toMatchObject({ ok: false });
	host.change(id, (entry) => {
		entry.ids.push("key");
		entry.byId.set("key", row("replacement"));
	});
	const replaced = instance.capture().enumerateRows("root");
	expect(replaced.ok && replaced.rows[1]?.token).not.toBe(first.token);
	expect(instance.capture().evaluate(slot, scope)).toMatchObject({ ok: false });
	const separateRows = separate.capture().enumerateRows("root");
	expect(separateRows.ok && separateRows.rows[0]?.token).not.toBe(second.token);
	instance.dispose();
	separate.dispose();
});

it("publishes independent frozen child entries, including nested ancestors", () => {
	const host = snapshotHost();
	const instance = installed(host.strategy);
	const id = [...host.states.keys()][0] as object;
	const parent = (host.states.get(id) as SnapshotState).rows[0] as Item;
	const child = row("child");
	parent.nested.push(child);
	const original = host.strategy.capture.bind(host.strategy);
	const supplied: { name: string; token: object }[] = [];
	const spy = vi.spyOn(host.strategy, "capture").mockImplementation((context) => {
		const frame = original(context);
		return {
			...frame,
			enumerateRows(scope, binding, name, capacity) {
				const result = frame.enumerateRows?.(scope, binding, name, capacity) as RowEnumeration;
				if (result.status === "found")
					for (const descriptor of result.rows) supplied.push(...(descriptor.scope.rows as typeof supplied));
				return result;
			},
		};
	});
	const capture = instance.capture();
	const outer = capture.enumerateRows("root");
	if (!outer.ok) throw new Error(outer.code);
	const inner = capture.enumerateRows("root.children[0]", outer.rows[0]?.scope);
	if (!inner.ok) throw new Error(inner.code);
	const scope = inner.rows[0]?.scope as ReadScope;
	for (const entry of scope.rows) {
		expect(Object.isFrozen(entry)).toBe(true);
		expect(Reflect.set(entry, "token", {})).toBe(false);
		expect(Reflect.set(entry, "name", "wrong")).toBe(false);
	}
	expect(Object.isFrozen(scope.rows)).toBe(true);
	expect(Reflect.set(outer.rows[0]?.scope.rows[0] as object, "token", {})).toBe(false);
	for (const entry of supplied.filter((item) => !Object.isFrozen(item))) {
		entry.token = {};
		entry.name = "corrupt";
	}
	expect(scope.rows.map((entry) => entry.name)).toEqual(["outer", "inner"]);
	expect(scope.rows.map((entry) => entry.token)).toEqual([parent.token, child.token]);
	expect(capture.evaluate(slot, scope)).toEqual({ ok: true, value: "child" });
	spy.mockRestore();
	instance.dispose();
});

it("session evaluates only the selected lazy reference branch", () => {
	const source = structuredClone(definition) as unknown as {
		root: { children: { children: { value: unknown }[] }[] };
	};
	source.root.children[0].children[0].value = program({
		kind: "conditional",
		condition: { kind: "literal", value: true },
		[thenKey]: { kind: "ref", ref: ref(["value"], "inner") },
		else: { kind: "ref", ref: ref(["unused"], "inner") },
	});
	const host = snapshotHost();
	const instance = installed(host.strategy, source);
	const id = [...host.states.keys()][0] as object;
	(host.states.get(id) as SnapshotState).rows[0]?.nested.push(row("selected"));
	const capture = instance.capture();
	const outer = capture.enumerateRows("root");
	if (!outer.ok) throw new Error(outer.code);
	const inner = capture.enumerateRows("root.children[0]", outer.rows[0]?.scope);
	if (!inner.ok) throw new Error(inner.code);
	expect(host.reads).not.toHaveBeenCalled();
	expect(capture.evaluate(slot, inner.rows[0]?.scope)).toEqual({ ok: true, value: "selected" });
	expect(host.reads).toHaveBeenCalledTimes(1);
	expect(host.reads.mock.calls[0]?.[0].path.at(-1)).toBe("value");
	instance.dispose();
});

it("rejects stolen frames, capacity and reentrant invalidation at the binding path", () => {
	const host = snapshotHost();
	const instance = installed(host.strategy);
	const id = [...host.states.keys()][0] as object;
	const frame = instance.capture();
	const valid = frame.enumerateRows("root", { rows: [] }, 2);
	expect(valid.ok).toBe(true);
	const stolenInstance = installed(host.strategy);
	const stolenFrame = instance.capture();
	// A frame captured by another form must not enumerate even when revision tokens collide.
	host.steal(
		(host.strategy.capture as (context: DataContext) => DataFrame)({
			instance: id,
			...identity,
			policyGeneration: "g1",
			policyFingerprint: "host",
		}),
	);
	expect(stolenInstance.capture().enumerateRows("root", { rows: [] }, 2)).toEqual({
		ok: false,
		path: "root.binding",
		code: "STALE_CAPTURE",
	});
	expect(stolenFrame.enumerateRows("root", { rows: [] }, 1)).toEqual({
		ok: false,
		path: "root.binding",
		code: "ROW_CAPACITY",
	});
	host.on(() => host.change(id, () => {}));
	expect(instance.capture().enumerateRows("root", { rows: [] }, 2)).toEqual({
		ok: false,
		path: "root.binding",
		code: "STALE_CAPTURE",
	});
	host.on(() => instance.dispose());
	expect(instance.capture().enumerateRows("root", { rows: [] }, 2)).toEqual({
		ok: false,
		path: "root.binding",
		code: "STALE_CAPTURE",
	});
	stolenInstance.dispose();
});

it("fails closed for malformed or unavailable host enumerations", () => {
	const host = snapshotHost();
	const instance = installed(host.strategy);
	const token = {};
	const descriptor = (value: object, order: number, name = "outer") => ({
		token: value,
		order,
		scope: { rows: [{ name, token: value }] },
	});
	const invalid = [
		[{ status: "missing" }, "ROW_MISSING"],
		[{ status: "denied" }, "ROW_DENIED"],
		[{ status: "stale" }, "STALE_CAPTURE"],
		[{ status: "capacity" }, "ROW_CAPACITY"],
		[{ status: "found", rows: [descriptor(token, 0), descriptor(token, 1)] }, "INVALID_ROWS"],
		[{ status: "found", rows: [{ token: 0, order: 0, scope: { rows: [] } }] }, "INVALID_ROWS"],
		[{ status: "found", rows: [descriptor({}, 1)] }, "INVALID_ROWS"],
		[{ status: "found", rows: [descriptor({}, 0, "wrong")] }, "INVALID_ROWS"],
		[{ status: "found", rows: [descriptor({}, 0), descriptor({}, 1), descriptor({}, 2)] }, "ROW_CAPACITY"],
	] as const;
	const original = host.strategy.capture.bind(host.strategy);
	const spy = vi.spyOn(host.strategy, "capture");
	for (const [result, code] of invalid) {
		spy.mockImplementation((context) => ({ ...original(context), enumerateRows: () => result as RowEnumeration }));
		expect(instance.capture().enumerateRows("root", { rows: [] }, 2)).toEqual({
			ok: false,
			path: "root.binding",
			code,
		});
	}
	spy.mockImplementation((context) => ({
		...original(context),
		enumerateRows: () => {
			throw new Error("host");
		},
	}));
	expect(instance.capture().enumerateRows("root", { rows: [] }, 2)).toEqual({
		ok: false,
		path: "root.binding",
		code: "STRATEGY_ERROR",
	});
	spy.mockImplementation((context) => ({ ...original(context), enumerateRows: undefined }));
	expect(instance.capture().enumerateRows("root", { rows: [] }, 2)).toEqual({
		ok: false,
		path: "root.binding",
		code: "ROW_ENUMERATION_UNAVAILABLE",
	});
	spy.mockRestore();
	instance.dispose();
});
