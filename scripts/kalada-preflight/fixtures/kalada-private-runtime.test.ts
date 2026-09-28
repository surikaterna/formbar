import { expect, it, vi } from "vitest";
import type {
	DataContext,
	DataRead,
	FormbarDataStrategyV1,
	ReadScope,
} from "../../../packages/declarative/src/validators/kalada-data-strategy.js";
import { snapshotAdmissionPolicy } from "../../../packages/declarative/src/validators/kalada-policy.js";
import {
	KALADA_RUNTIME_ARTIFACT,
	createPrivateKaladaRuntime,
} from "../../../packages/declarative/src/validators/kalada-private-runtime.js";
import type { StaticReference } from "../../../packages/declarative/src/validators/static-references.js";

const identity = { generation: "g1", fingerprint: "host" };
const ref = (segments: string[], scope?: string) => ({ namespace: "data", segments, ...(scope ? { scope } : {}) });
const program = (expression: unknown) => ({ format: "kalada-program", version: 1, profile: "kalada-v1", expression });
const thenKey = "then";
const read = (key: string, scope?: string) => ({ kind: "ref", ref: ref([key], scope) });
const paths = [
	{ path: ["flag"], kind: "value" },
	{ path: ["other"], kind: "value" },
	{ path: ["rows"], kind: "array" },
	{ path: ["rows", { row: "outer" }, "nested"], kind: "array" },
	{ path: ["rows", { row: "outer" }, "nested", { row: "inner" }, "value"], kind: "value" },
];
const policy = snapshotAdmissionPolicy({
	...identity,
	widgets: {},
	renderers: {},
	actions: {},
	namespaces: { data: "available" },
	schema: { side: "input", availability: "complete", paths },
	ui: { availability: "complete", paths: [] },
});
const definition = (expression: unknown, condition = false) => ({
	version: 1,
	id: "form",
	root: condition
		? { type: "conditional", id: "root", condition: program(expression), [thenKey]: [] }
		: { type: "output", id: "root", value: program(expression) },
	computations: [{ id: "never", target: ref(["other"]), expression: program(read("flag")) }],
});
const path = (condition = false) => (condition ? "root.condition" : "root.value");

function host(mode: "open" | "restrict", initial: unknown = true) {
	let token = {};
	let value = initial;
	let allowed = true;
	let listener = () => {};
	const reads = vi.fn((reference: StaticReference, scope: ReadScope): DataRead => {
		if (!allowed || (mode === "restrict" && reference.path[0] === "other")) return { status: "denied" };
		if (scope.rows.length && scope.rows[0]?.token !== outer) return { status: "denied" };
		return { status: "found", value: value as boolean };
	});
	const outer = {};
	const writeDirect = vi.fn();
	const strategy: FormbarDataStrategyV1 = {
		contract: "formbar-data-strategy-v1",
		identity: () => ({
			artifact: KALADA_RUNTIME_ARTIFACT,
			policyGeneration: identity.generation,
			policyFingerprint: identity.fingerprint,
		}),
		capture: (_context: DataContext) => {
			const captured = token;
			return { token: captured, read: reads };
		},
		current: () => token,
		subscribe: (_context, invalidate) => {
			listener = invalidate;
			return () => {
				listener = () => {};
			};
		},
		writeDirect,
	};
	return {
		strategy,
		reads,
		writeDirect,
		outer,
		change(next: unknown) {
			value = next;
			token = {};
			listener();
		},
		revoke() {
			allowed = false;
			token = {};
			listener();
		},
		rotate() {
			token = {};
		},
		setRead: (fn: typeof reads) => {
			reads.mockImplementation(fn);
		},
	};
}
const runtime = (adapter: ReturnType<typeof host>, expression: unknown, condition = false) =>
	createPrivateKaladaRuntime({
		definition: definition(expression, condition),
		identity,
		policy,
		strategy: adapter.strategy,
	});

it("isolates two installed strategies and revisions; never evaluates computations or writes", () => {
	const a = host("open", true);
	const b = host("restrict", false);
	const expression = {
		kind: "conditional",
		condition: read("flag"),
		[thenKey]: read("other"),
		else: { kind: "literal", value: null },
	};
	const first = runtime(a, expression);
	const second = runtime(b, expression);
	expect(a.reads).not.toHaveBeenCalled();
	expect(b.reads).not.toHaveBeenCalled();
	expect(first.evaluate(path())).toEqual({ ok: true, value: true });
	expect(second.evaluate(path())).toEqual({ ok: true, value: null });
	expect(b.reads).toHaveBeenCalledTimes(1);
	a.change(false);
	expect(first.evaluate(path())).toEqual({ ok: true, value: null });
	a.change(true);
	expect(first.evaluate(path())).toEqual({ ok: true, value: true });
	b.change(true);
	expect(second.evaluate(path())).toMatchObject({ ok: false, code: "KALADA_REFERENCE_DENIED" });
	expect(a.writeDirect).not.toHaveBeenCalled();
	expect(b.writeDirect).not.toHaveBeenCalled();
	first.dispose();
	expect(first.evaluate(path())).toMatchObject({ ok: false });
	second.dispose();
});

it("enforces result gates and canonical admission before any read", () => {
	for (const expression of [
		{ kind: "option", variant: "none" },
		{ kind: "option", variant: "some", value: { kind: "literal", value: true } },
		{ kind: "result", variant: "ok", value: { kind: "literal", value: true } },
		{ kind: "instant", milliseconds: 100 },
		{ kind: "duration", milliseconds: 100 },
	])
		for (const condition of [false, true]) {
			const adapter = host("open");
			const instance = runtime(adapter, expression, condition);
			expect(instance.evaluate(path(condition))).toMatchObject({ ok: false, path: path(condition) });
			expect(adapter.reads).not.toHaveBeenCalled();
			instance.dispose();
		}
	const adapter = host("open", 123);
	const instance = runtime(adapter, read("flag"), true);
	expect(instance.evaluate(path(true))).toMatchObject({ ok: false, code: "BOOLEAN_REQUIRED" });
	instance.dispose();
	expect(() => runtime(adapter, { kind: "ref", ref: ref(["unattested"]) })).toThrow();
	expect(adapter.reads).toHaveBeenCalledTimes(1);
});

it("copies bounded JSON without leaking source mutation and rejects non-JSON/oversize read values", () => {
	const adapter = host("open");
	const instance = runtime(adapter, read("flag"));
	const data = { nested: [1, null] };
	adapter.setRead(vi.fn(() => ({ status: "found", value: data })));
	expect(instance.evaluate(path())).toEqual({ ok: true, value: data });
	adapter.setRead(vi.fn(() => ({ status: "found", value: () => true })));
	expect(instance.evaluate(path())).toMatchObject({ ok: false, code: "KALADA_REFERENCE_ERROR" });
	adapter.setRead(vi.fn(() => ({ status: "found", value: "x".repeat(20000) })));
	expect(instance.evaluate(path())).toMatchObject({ ok: false });
	instance.dispose();
});

it("never invokes validation-time evaluator, renderer, capability or data callbacks", () => {
	const adapter = host("open");
	const capture = vi.spyOn(adapter.strategy, "capture");
	const current = vi.spyOn(adapter.strategy, "current");
	const evaluator = vi.fn();
	const renderer = vi.fn();
	const capability = vi.fn();
	const invalid = {
		...definition(read("flag")),
		root: {
			type: "output",
			id: "root",
			value: program(read("flag")),
			get renderer() {
				renderer();
				return "unsafe";
			},
		},
	};
	expect(() =>
		createPrivateKaladaRuntime({ definition: invalid, policy, identity, strategy: adapter.strategy }),
	).toThrow();
	expect(renderer).not.toHaveBeenCalled();
	expect(evaluator).not.toHaveBeenCalled();
	expect(capability).not.toHaveBeenCalled();
	expect(capture).not.toHaveBeenCalled();
	expect(current).not.toHaveBeenCalled();
	expect(adapter.writeDirect).not.toHaveBeenCalled();
	const instance = runtime(adapter, read("flag"));
	expect(capture).not.toHaveBeenCalled();
	expect(current).not.toHaveBeenCalled();
	expect(adapter.reads).not.toHaveBeenCalled();
	instance.dispose();
});

it("fails closed on missing, denied, stale during read or publish, revocation and installation drift", () => {
	const adapter = host("open");
	const instance = runtime(adapter, read("flag"));
	for (const status of ["missing", "denied", "stale"] as const) {
		adapter.setRead(vi.fn(() => ({ status })));
		expect(instance.evaluate(path())).toMatchObject({ ok: false });
	}
	adapter.setRead(
		vi.fn(() => {
			adapter.rotate();
			return { status: "found", value: true };
		}),
	);
	expect(instance.evaluate(path())).toMatchObject({ ok: false, code: "STALE_CAPTURE" });
	adapter.setRead(
		vi.fn(() => {
			adapter.revoke();
			return { status: "found", value: true };
		}),
	);
	expect(instance.evaluate(path())).toMatchObject({ ok: false, code: "STALE_CAPTURE" });
	instance.dispose();
	const wrong = {
		...adapter.strategy,
		identity: () => ({ artifact: "other", ...identity, policyGeneration: "g1", policyFingerprint: "host" }),
	};
	expect(() =>
		createPrivateKaladaRuntime({ definition: definition(read("flag")), policy, identity, strategy: wrong }),
	).toThrow("STALE_INSTALLATION");
});

it("passes typed nested row descriptors, rejects missing scope and never caches an index across reorder", () => {
	const adapter = host("open");
	const expression = read("value", "inner");
	const definitionWithRows = {
		version: 1,
		id: "form",
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
					children: [{ type: "output", id: "out", value: program(expression) }],
				},
			],
		},
	};
	const instance = createPrivateKaladaRuntime({
		definition: definitionWithRows,
		identity,
		policy,
		strategy: adapter.strategy,
	});
	const slot = "root.children[0].children[0].value";
	expect(instance.evaluate(slot)).toMatchObject({ ok: false, code: "INVALID_SCOPE" });
	const inner = {};
	const scope = {
		rows: [
			{ name: "outer", token: adapter.outer },
			{ name: "inner", token: inner },
		],
	};
	expect(instance.evaluate(slot, scope)).toMatchObject({ ok: true });
	expect(adapter.reads.mock.calls[0]?.[0].path).toEqual([
		"rows",
		{ row: "outer" },
		"nested",
		{ row: "inner" },
		"value",
	]);
	adapter.change(false);
	expect(instance.evaluate(slot, scope)).toMatchObject({ ok: true, value: false });
	const removed = {
		rows: [
			{ name: "outer", token: {} },
			{ name: "inner", token: inner },
		],
	};
	expect(instance.evaluate(slot, removed)).toMatchObject({ ok: false, code: "KALADA_REFERENCE_DENIED" });
	instance.dispose();
});
