import { expect, it, vi } from "vitest";
import type {
	DataContext,
	DataFrame,
	DataRead,
	FormbarDataStrategyV1,
	ReadScope,
} from "../../../packages/declarative/src/validators/kalada-data-strategy.js";
import { snapshotAdmissionPolicy } from "../../../packages/declarative/src/validators/kalada-policy.js";
import {
	KALADA_RUNTIME_ARTIFACT,
	createPrivateKaladaRuntime,
} from "../../../packages/declarative/src/validators/kalada-private-runtime.js";

const identity = { generation: "g1", fingerprint: "host" };
const ref = (segments: string[], scope?: string) => ({ namespace: "data", segments, ...(scope ? { scope } : {}) });
const read = (name: string, scope?: string) => ({ kind: "ref", ref: ref([name], scope) });
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
			{ path: ["flag"], kind: "value" },
			{ path: ["rows"], kind: "array" },
			{ path: ["rows", { row: "row" }, "value"], kind: "value" },
		],
	},
	ui: { availability: "complete", paths: [] },
});
const definition = (expression: unknown) => ({
	version: 1,
	id: "form",
	root: { type: "output", id: "root", value: program(expression) },
});
const rowDefinition = {
	version: 1,
	id: "form",
	root: {
		type: "repeater",
		id: "list",
		scope: "row",
		binding: ref(["rows"]),
		children: [{ type: "output", id: "out", value: program(read("value", "row")) }],
	},
};
const rowSlot = "root.children[0].value";
const installed = (strategy: FormbarDataStrategyV1, rows = false) =>
	createPrivateKaladaRuntime({
		definition: rows ? rowDefinition : definition(read("flag")),
		policy,
		identity,
		strategy,
	});
const installation = () => ({
	artifact: KALADA_RUNTIME_ARTIFACT,
	policyGeneration: identity.generation,
	policyFingerprint: identity.fingerprint,
});

// This host snapshots an immutable scalar; capture/read do not consult another instance's state.
function snapshotHost() {
	const contexts = new Set<object>();
	const frames = new Map<object, DataFrame>();
	const reads = vi.fn();
	let revision = {};
	let value = true;
	let notify = () => {};
	let active: object | undefined;
	let stolen: DataFrame | undefined;
	const assertContext = (context: DataContext) => {
		expect(contexts.has(context.instance)).toBe(true);
		expect(context.policyGeneration).toBe(identity.generation);
		expect(context.policyFingerprint).toBe(identity.fingerprint);
	};
	const strategy: FormbarDataStrategyV1 = {
		contract: "formbar-data-strategy-v1",
		identity(context) {
			contexts.add(context.instance);
			return installation();
		},
		capture(context) {
			assertContext(context);
			active = context.instance;
			if (stolen) {
				const frame = stolen;
				stolen = undefined;
				return frame;
			}
			const captured = value;
			const frame: DataFrame = {
				token: revision,
				read(_reference, _scope) {
					reads(context.instance);
					return active === context.instance && contexts.has(context.instance) && frames.get(context.instance) === frame
						? { status: "found", value: captured }
						: { status: "denied" };
				},
			};
			frames.set(context.instance, frame);
			return frame;
		},
		current(context) {
			assertContext(context);
			return revision;
		},
		subscribe(context, invalidate) {
			assertContext(context);
			notify = invalidate;
			return () => {
				notify = () => {};
				frames.delete(context.instance);
			};
		},
	};
	return {
		strategy,
		reads,
		contexts,
		frames,
		steal(frame: DataFrame) {
			stolen = frame;
		},
		change() {
			value = false;
			revision = {};
			notify();
		},
	};
}

// Unlike the snapshot host, this host resolves live values through instance-scoped storage.
function liveHost() {
	const entries = new Map<object, { token: object; value: boolean; notify: () => void }>();
	const reads = vi.fn();
	const entry = (context: DataContext) => {
		const state = entries.get(context.instance);
		if (!state) throw new Error("foreign instance");
		return state;
	};
	const strategy: FormbarDataStrategyV1 = {
		contract: "formbar-data-strategy-v1",
		identity(context) {
			if (!entries.has(context.instance)) entries.set(context.instance, { token: {}, value: false, notify: () => {} });
			return installation();
		},
		capture(context) {
			const state = entry(context);
			const token = state.token;
			return {
				token,
				read(_reference, _scope) {
					reads(context.instance);
					return entry(context) === state && state.token === token
						? { status: "found", value: state.value }
						: { status: "stale" };
				},
			};
		},
		current(context) {
			return entry(context).token;
		},
		subscribe(context, invalidate) {
			entry(context).notify = invalidate;
			return () => {
				entry(context).notify = () => {};
			};
		},
	};
	return {
		strategy,
		reads,
		entries,
		change(instance: object) {
			const state = entries.get(instance);
			if (!state) throw new Error("unknown instance");
			state.value = true;
			state.token = {};
			state.notify();
		},
	};
}

it("installs two different hosts and binds captured frames to the exact form instance", () => {
	const snapshot = snapshotHost();
	const live = liveHost();
	const first = installed(snapshot.strategy);
	const second = installed(live.strategy);
	const third = installed(live.strategy);
	expect(snapshot.reads).not.toHaveBeenCalled();
	expect(live.reads).not.toHaveBeenCalled();
	expect(first.evaluate("root.value")).toEqual({ ok: true, value: true });
	expect(second.evaluate("root.value")).toEqual({ ok: true, value: false });
	expect(third.evaluate("root.value")).toEqual({ ok: true, value: false });
	const [secondInstance, thirdInstance] = [...live.entries.keys()];
	expect(secondInstance).not.toBe(thirdInstance);
	expect(snapshot.contexts.has(secondInstance)).toBe(false);
	const foreign = snapshot.frames.values().next().value;
	const fourth = installed(snapshot.strategy);
	snapshot.steal(foreign as DataFrame);
	expect(fourth.evaluate("root.value")).toEqual({ ok: false, path: "root.value", code: "KALADA_REFERENCE_DENIED" });
	expect(snapshot.reads).toHaveBeenCalledTimes(2);
	live.change(secondInstance);
	expect(second.evaluate("root.value")).toEqual({ ok: true, value: true });
	expect(third.evaluate("root.value")).toEqual({ ok: true, value: false });
	snapshot.change();
	expect(first.evaluate("root.value")).toEqual({ ok: true, value: false });
	first.dispose();
	second.dispose();
	third.dispose();
	fourth.dispose();
});

it("resolves stable row aliases after reorder and denies removed aliases without retargeting", () => {
	const alpha = { alias: "alpha" };
	const beta = { alias: "beta" };
	const rows = [
		{ token: alpha, value: "A" },
		{ token: beta, value: "B" },
	];
	let version = {};
	let notify = () => {};
	let duringRead = () => {};
	const reads = vi.fn();
	const strategy: FormbarDataStrategyV1 = {
		contract: "formbar-data-strategy-v1",
		identity: () => installation(),
		capture: (_context) => {
			const token = version;
			return {
				token,
				read(reference, scope) {
					reads(reference, scope);
					if (token !== version) return { status: "stale" };
					duringRead();
					if (reference.path.length !== 3 || scope.rows[0]?.name !== "row") return { status: "denied" };
					const row = rows.find((item) => item.token === scope.rows[0]?.token);
					return row ? { status: "found", value: row.value } : { status: "denied" };
				},
			};
		},
		current: () => version,
		subscribe: (_context, invalidate) => {
			notify = invalidate;
			return () => {
				notify = () => {};
			};
		},
	};
	const instance = installed(strategy, true);
	const alphaScope: ReadScope = { rows: [{ name: "row", token: alpha }] };
	const betaScope: ReadScope = { rows: [{ name: "row", token: beta }] };
	expect(instance.evaluate(rowSlot, alphaScope)).toEqual({ ok: true, value: "A" });
	duringRead = () => {
		duringRead = () => {};
		rows.reverse();
	};
	expect(instance.evaluate(rowSlot, alphaScope)).toEqual({ ok: true, value: "A" });
	rows.reverse();
	version = {};
	notify();
	expect(instance.evaluate(rowSlot, alphaScope)).toEqual({ ok: true, value: "A" });
	expect(instance.evaluate(rowSlot, betaScope)).toEqual({ ok: true, value: "B" });
	duringRead = () => {
		duringRead = () => {};
		rows.splice(
			rows.findIndex((row) => row.token === alpha),
			1,
		);
		version = {};
		notify();
	};
	expect(instance.evaluate(rowSlot, alphaScope)).toEqual({ ok: false, path: rowSlot, code: "STALE_CAPTURE" });
	expect(instance.evaluate(rowSlot, alphaScope)).toEqual({ ok: false, path: rowSlot, code: "KALADA_REFERENCE_DENIED" });
	expect(instance.evaluate(rowSlot, betaScope)).toEqual({ ok: true, value: "B" });
	expect(reads).toHaveBeenCalledTimes(7);
	instance.dispose();
});

it("rejects synchronous subscription invalidation, mid-read disposal and stale diagnostic precedence", () => {
	let invalidate = () => {};
	let onRead: () => DataRead = () => ({ status: "missing" });
	let version = {};
	const reads = vi.fn();
	const strategy: FormbarDataStrategyV1 = {
		contract: "formbar-data-strategy-v1",
		identity: () => installation(),
		capture: () => ({
			token: version,
			read() {
				reads();
				return onRead();
			},
		}),
		current: () => version,
		subscribe: (_context, callback) => {
			invalidate = callback;
			callback();
			return () => {
				invalidate = () => {};
			};
		},
	};
	const instance = installed(strategy);
	expect(reads).not.toHaveBeenCalled();
	expect(instance.evaluate("root.value")).toEqual({ ok: false, path: "root.value", code: "KALADA_REFERENCE_MISSING" });
	onRead = () => ({ status: "denied" });
	expect(instance.evaluate("root.value")).toEqual({ ok: false, path: "root.value", code: "KALADA_REFERENCE_DENIED" });
	onRead = () => {
		invalidate();
		return { status: "missing" } as const;
	};
	expect(instance.evaluate("root.value")).toEqual({ ok: false, path: "root.value", code: "STALE_CAPTURE" });
	onRead = () => {
		version = {};
		return { status: "denied" } as const;
	};
	expect(instance.evaluate("root.value")).toEqual({ ok: false, path: "root.value", code: "STALE_CAPTURE" });
	onRead = () => {
		instance.dispose();
		return { status: "found", value: "should-not-publish" } as const;
	};
	expect(instance.evaluate("root.value")).toEqual({ ok: false, path: "root.value", code: "STALE_CAPTURE" });
	expect(reads).toHaveBeenCalledTimes(5);
	expect(instance.evaluate("root.value")).toEqual({ ok: false, path: "root.value", code: "STALE_INSTALLATION" });
	expect(reads).toHaveBeenCalledTimes(5);
});
