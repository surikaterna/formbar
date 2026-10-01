import { expect, it, vi } from "vitest";
import { createFormRuntime, validateFormDefinition } from "../../../packages/declarative/src/index.js";
import type { FormbarDataStrategyV1 } from "../../../packages/declarative/src/validators/kalada-data-strategy.js";
import { quantityPath, serialHost } from "./row-write-hosts.js";

const identity = { generation: "g1", fingerprint: "host" };
const ref = (segments: string[], scope?: string) => ({
	namespace: "data",
	segments,
	...(scope ? { scope } : {}),
});
const program = (expression: unknown) => ({ format: "kalada-program", version: 1, profile: "kalada-v1", expression });
const readName = program({ kind: "ref", ref: ref(["profile", "name"]) });
const output = (value: unknown = readName) => ({ type: "output", id: "summary", format: "plain", value });
const definition = (root: unknown) => ({ version: 1, id: "output", root });
const policy = {
	...identity,
	widgets: {},
	renderers: {},
	actions: {},
	namespaces: { data: "available" },
	schema: {
		side: "input",
		availability: "complete",
		paths: [
			{ path: ["profile", "name"], kind: "value" },
			{ path: ["rows"], kind: "array" },
			{ path: ["rows", { row: "outer" }, "nested"], kind: "array" },
			{ path: quantityPath, kind: "value" },
		],
	},
	ui: { availability: "complete", paths: [] },
};

function start(root: unknown, strategy: FormbarDataStrategyV1 = serialHost().strategy, computations?: unknown) {
	const candidate = { ...definition(root), ...(computations === undefined ? {} : { computations }) };
	const result = validateFormDefinition(candidate, { identity, policy, strategy });
	if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
	return { runtime: createFormRuntime({ definition: result.value }), instance: result.value.prepared.context.instance };
}

it("projects basic output using one installed frame and refreshes on the host revision", () => {
	const host = serialHost();
	const capture = vi.spyOn(host.strategy, "capture");
	const current = vi.spyOn(host.strategy, "current");
	const { runtime, instance } = start(output(), host.strategy);
	expect(capture).not.toHaveBeenCalled();
	expect(current).not.toHaveBeenCalled();
	const state = host.states.get(instance);
	if (!state) throw new Error("missing installed state");
	expect(runtime.snapshot().outputs).toMatchObject([{ nodeId: "summary", value: "original", format: "plain" }]);
	state.field.value = "edited";
	host.bump(state);
	expect(runtime.snapshot().outputs[0]?.value).toBe("edited");
	runtime.dispose();
});

it("keeps stored computations static and does not schedule or write output values", () => {
	const host = serialHost();
	const writeDirect = vi.fn(() => ({ status: "denied" as const }));
	const strategy = { ...host.strategy, writeDirect };
	const { runtime, instance } = start(output(), strategy, [
		{
			id: "not-a-writer",
			target: ref(["profile", "name"]),
			expression: program({ kind: "literal", value: "overwrite" }),
		},
	]);
	const state = host.states.get(instance);
	expect(runtime.snapshot().outputs[0]?.value).toBe("original");
	expect(state?.field.value).toBe("original");
	expect(writeDirect).not.toHaveBeenCalled();
	runtime.dispose();
});

it("accepts JSON null but rejects Option.some/none at the exact output slot", () => {
	const nullable = start(output(program({ kind: "literal", value: null })));
	expect(nullable.runtime.snapshot().outputs[0]?.value).toBeNull();
	nullable.runtime.dispose();
	for (const expression of [
		{ kind: "option", variant: "none" },
		{ kind: "option", variant: "some", value: { kind: "literal", value: "x" } },
	]) {
		const { runtime } = start(output(program(expression)));
		expect(() => runtime.snapshot()).toThrow("root.value: INVALID_RESULT_TYPE");
		runtime.dispose();
	}
});

it("enforces strict conditional Boolean and never evaluates an inactive output branch", () => {
	const branch = (condition: unknown) => ({
		type: "conditional",
		id: "gate",
		condition: program({ kind: "literal", value: condition }),
		...JSON.parse('{"then":[]}'),
		else: [output(program({ kind: "option", variant: "none" }))],
	});
	const active = start(branch(true));
	expect(active.runtime.snapshot().outputs).toEqual([]);
	active.runtime.dispose();
	const malformed = start(branch("true"));
	expect(() => malformed.runtime.snapshot()).toThrow("root.condition: BOOLEAN_REQUIRED");
	malformed.runtime.dispose();
});

it("keeps nested output bound to host row tokens across reorder and rejects stale frames", () => {
	const host = serialHost();
	const nested = definition({
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
				children: [output(program({ kind: "ref", ref: ref(["quantity"], "inner") }))],
			},
		],
	});
	const { runtime, instance } = start(nested.root, host.strategy);
	const state = host.states.get(instance);
	if (!state) throw new Error("missing installed state");
	const before = runtime.snapshot().outputs[0];
	expect(before?.value).toBe("child-quantity");
	state.roots.reverse();
	host.bump(state);
	expect(runtime.snapshot().outputs[0]).toMatchObject({ key: before?.key, value: "child-quantity" });
	runtime.dispose();
});

it("rejects an output read made stale during the captured frame", () => {
	const staleHost = serialHost();
	const strategy: FormbarDataStrategyV1 = {
		...staleHost.strategy,
		capture(context) {
			const frame = staleHost.strategy.capture(context);
			return {
				...frame,
				read(reference, scope) {
					const state = staleHost.states.get(context.instance);
					if (state) staleHost.bump(state);
					return frame.read(reference, scope);
				},
			};
		},
	};
	const stale = start(output(), strategy);
	expect(() => stale.runtime.snapshot()).toThrow("root.value: STALE_CAPTURE");
	stale.runtime.dispose();
});

it("rejects non-JSON host reads at the exact output value path", () => {
	const host = serialHost();
	const strategy: FormbarDataStrategyV1 = {
		...host.strategy,
		capture(context) {
			const frame = host.strategy.capture(context);
			return {
				...frame,
				read: () => ({ status: "found", value: (() => "not JSON") as never }),
			};
		},
	};
	const { runtime } = start(output(), strategy);
	expect(() => runtime.snapshot()).toThrow("root.value: KALADA_REFERENCE_ERROR");
	runtime.dispose();
});

it("admits supported formatting but rejects output props at their exact path", () => {
	expect(
		validateFormDefinition(definition({ ...output(), format: "currency-usd" }), {
			identity,
			policy,
			strategy: serialHost().strategy,
		}).ok,
	).toBe(true);
	expect(
		validateFormDefinition(definition({ ...output(), props: { tone: { mode: "literal", value: "primary" } } }), {
			identity,
			policy,
			strategy: serialHost().strategy,
		}),
	).toMatchObject({
		ok: false,
		diagnostics: [{ path: ["root", "props"], message: "UNSUPPORTED_V1_RE-AUTHOR" }],
	});
});
