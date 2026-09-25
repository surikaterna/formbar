import { describe, expect, it } from "vitest";
import { FormStore } from "../store.js";
import { createSubmitCandidate } from "../submit-candidate-safety.js";

function fixture() {
	const data = { visible: { name: "Ada" }, hidden: { token: "secret" } };
	const uiState = { view: { tab: 1 } };
	const issues = [{ message: "retained" }];
	return { data, uiState, issues };
}

describe("detached submit candidate", () => {
	it("never freezes or changes retained store nodes on success or failure", () => {
		const source = fixture();
		const store = new FormStore({
			data: source.data,
			uiState: source.uiState,
			issues: [
				{
					code: "retained",
					message: "retained",
					severity: "error" as const,
					path: { namespace: "data" as const, segments: ["visible"] },
					source: { origin: "submit" as const, validatorId: "fixture" },
				},
			],
			meta: { validation: {} },
			fieldMeta: {},
			fieldPolicy: [],
		});
		const state = store.getState();
		const original = structuredClone(state);
		const visible = state.data.visible;
		const issues = state.issues;
		const result = createSubmitCandidate(state, (input) => ({ visible: input.data.visible.name }), [
			(value) => ({ ...(value as object), visible: "Grace" }),
		]);
		expect(result).toEqual({ ok: true, data: { visible: "Grace" }, uiState: state.uiState });
		if (result.ok) {
			expect(Object.isFrozen(result.data)).toBe(true);
			expect(Object.isFrozen(result.uiState.view)).toBe(true);
			expect(result.uiState).not.toBe(state.uiState);
		}
		expect(createSubmitCandidate(state, () => state.data)).toEqual({ ok: false, code: "unsafe_candidate" });
		expect(state).toEqual(original);
		expect(state.data.visible).toBe(visible);
		expect(state.issues).toBe(issues);
		expect(store.getState()).toBe(state);
		expect(Object.isFrozen(visible)).toBe(false);
		expect(Object.isFrozen(state.uiState.view)).toBe(false);
		expect(Object.isFrozen(issues)).toBe(true);
		visible.name = "mutable";
	});

	it("rejects adapter and egress aliases, mutation, and invalid graphs", () => {
		const state = fixture();
		const fail = (
			project: Parameters<typeof createSubmitCandidate>[1],
			transforms: Parameters<typeof createSubmitCandidate>[2] = [],
		) => expect(createSubmitCandidate(state, project, transforms)).toEqual({ ok: false, code: "unsafe_candidate" });
		fail((input) => input.data);
		fail(() => state);
		fail(() => ({ ref: state.data.visible }));
		fail(() => ({ ok: true }), [(value, context) => ({ value, context })]);
		fail(
			() => ({ ok: true }),
			[
				(value) => {
					(value as { ok: boolean }).ok = false;
					return value;
				},
			],
		);
		fail(() => ({ ok: true }), [(_value, context) => context.uiState]);
		fail(() => ({ ok: true }), [() => state.uiState]);
		fail(() => ({ ok: true }), [() => ({ nested: state.data.visible })]);
		fail(() => ({ ok: true }), [(_value, context) => ({ nested: context.data })]);
		let adapterCapture: unknown;
		fail(
			(input) => {
				adapterCapture = input;
				return { ok: true };
			},
			[() => adapterCapture],
		);
		fail(() => ({ ok: true }), [(value, context) => ({ ...(value as object), ui: context.uiState })]);
		let projected: { ok: boolean };
		fail(() => {
			projected = { ok: true };
			return projected;
		}, [
			() => {
				projected.ok = false;
				return { ok: true };
			},
		]);
		expect(Object.isFrozen(state.uiState.view)).toBe(false);
		const shared = {};
		fail(() => ({ a: shared, b: shared }));
		const cycle: { self?: unknown } = {};
		cycle.self = cycle;
		fail(() => cycle);
		fail(() => new Array(2));
		fail(() => new Date());
		fail(() => Object.create({ inherited: 1 }));
		fail(() => ({ invalid: Number.POSITIVE_INFINITY }));
		fail(() => Object.defineProperty({}, "hidden", { value: 1 }));
		fail(() => ({ [Symbol("key")]: 1 }));
		fail(() => ({ constructor: 1 }));
		fail(() => ({ big: 1n }));
		const sharedBetweenRoots = { item: 1 };
		expect(createSubmitCandidate({ data: sharedBetweenRoots, uiState: sharedBetweenRoots }, () => ({}))).toEqual({
			ok: false,
			code: "unsafe_candidate",
		});
		expect(state.data.visible.name).toBe("Ada");
	});

	it("rejects getters without calling them, proxies, depth and byte budgets", () => {
		const state = fixture();
		let called = false;
		const accessor = Object.defineProperty({}, "secret", {
			enumerable: true,
			get() {
				called = true;
				return 1;
			},
		});
		const revoked = Proxy.revocable({}, {});
		revoked.revoke();
		for (const value of [accessor, revoked.proxy, { text: "a".repeat(1_000_001) }, Array(10_001).fill(1)]) {
			expect(createSubmitCandidate(state, () => value)).toEqual({ ok: false, code: "unsafe_candidate" });
		}
		let deep: unknown = null;
		for (let i = 0; i < 40; i++) deep = { next: deep };
		expect(createSubmitCandidate(state, () => deep)).toEqual({ ok: false, code: "unsafe_candidate" });
		expect(called).toBe(false);
	});

	it("documents trusted-host boundary: projected descriptor traps can mutate retained data", () => {
		const state = fixture();
		const value = new Proxy(
			{ name: "Ada" },
			{
				getOwnPropertyDescriptor(target, key) {
					state.data.visible.name = "tampered";
					return Reflect.getOwnPropertyDescriptor(target, key);
				},
			},
		);
		expect(createSubmitCandidate(state, () => value)).toEqual({
			ok: true,
			data: { name: "Ada" },
			uiState: { view: { tab: 1 } },
		});
		expect(state.data.visible.name).toBe("tampered");
		expect(Object.isFrozen(state.data.visible)).toBe(false);
	});

	it("documents trusted-host boundary: egress descriptor traps can mutate retained UI", () => {
		const state = fixture();
		const result = createSubmitCandidate(state, () => ({ name: "Ada" }), [
			() =>
				new Proxy(
					{ name: "Ada" },
					{
						getOwnPropertyDescriptor(target, key) {
							state.uiState.view.tab = 99;
							return Reflect.getOwnPropertyDescriptor(target, key);
						},
					},
				),
		]);
		expect(result).toEqual({ ok: true, data: { name: "Ada" }, uiState: { view: { tab: 1 } } });
		expect(state.uiState.view.tab).toBe(99);
		expect(Object.isFrozen(state.uiState.view)).toBe(false);
	});

	it("fails closed on a descriptor trap throw without mutating retained state", () => {
		const state = fixture();
		const before = structuredClone(state);
		const result = createSubmitCandidate(
			state,
			() =>
				new Proxy(
					{ name: "Ada" },
					{
						getOwnPropertyDescriptor() {
							throw new Error("secret");
						},
					},
				),
		);
		expect(result).toEqual({ ok: false, code: "unsafe_candidate" });
		expect(
			createSubmitCandidate(state, () => ({ name: "Ada" }), [
				() =>
					new Proxy(
						{ name: "Ada" },
						{
							getOwnPropertyDescriptor() {
								throw new Error("secret");
							},
						},
					),
			]),
		).toEqual({ ok: false, code: "unsafe_candidate" });
		expect(state).toEqual(before);
		expect(Object.isFrozen(state.data.visible)).toBe(false);
	});

	it("documents opaque transparent proxies without claiming target alias detection", () => {
		const state = { data: { name: "Ada" }, uiState: { tab: 1 } };
		const result = createSubmitCandidate(state, () => new Proxy(state.data, {}));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data).not.toBe(state.data);
		expect(result.data).toEqual(state.data);
		expect(Object.isFrozen(state.data)).toBe(false);
		expect(state.data.name).toBe("Ada");
	});

	it("does not rescan a trusted retained UI proxy after taking the owned capture", () => {
		let reads = 0;
		const state = {
			data: { x: 1 },
			uiState: new Proxy(
				{ tab: 1 },
				{
					getOwnPropertyDescriptor(target, key) {
						reads++;
						// Auditor n=6 repro at ef43d5b: a final retained read mutated data after its last check.
						if (reads === 6) state.data.x = 99;
						return Reflect.getOwnPropertyDescriptor(target, key);
					},
				},
			),
		};
		const result = createSubmitCandidate(state, () => ({ ok: true }));
		expect(result).toEqual({ ok: true, data: { ok: true }, uiState: { tab: 1 } });
		expect(reads).toBe(1);
		expect(state.data.x).toBe(1);
	});

	it("accepts null-root UI and rejects owned projection mutation with code-only failure", () => {
		const state = { data: { name: "Ada" }, uiState: null };
		let projected: { name: string };
		const result = createSubmitCandidate(
			state,
			() => {
				projected = { name: "Ada" };
				return projected;
			},
			[
				() => {
					projected.name = "changed";
					return { name: "Grace" };
				},
			],
		);
		expect(result).toEqual({ ok: false, code: "unsafe_candidate" });
		expect(state.data.name).toBe("Ada");
		expect(createSubmitCandidate(state, () => ({ name: "Grace" }))).toEqual({
			ok: true,
			data: { name: "Grace" },
			uiState: null,
		});
	});

	it("egress sees only disjoint candidate data/UI, and unchanged input can be returned", () => {
		const state = fixture();
		let captured: unknown;
		const result = createSubmitCandidate(
			state,
			(input) => {
				captured = input;
				return { name: input.data.visible.name };
			},
			[
				(value, context) => {
					expect(Object.keys(context).sort()).toEqual(["data", "phase", "uiState"]);
					expect(context.data).not.toBe(captured);
					expect(context.uiState).not.toBe(state.uiState);
					expect(JSON.stringify(context)).not.toContain("secret");
					return value;
				},
			],
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).not.toBe(captured);
			expect(result.data).toEqual({ name: "Ada" });
			expect(result.data).toBe(result.data);
			expect(Object.isFrozen(captured)).toBe(true);
			expect(Object.isFrozen(result.uiState.view)).toBe(true);
		}
	});

	it("checked bytes remain stable across an asynchronous wait", async () => {
		const state = fixture();
		const result = createSubmitCandidate(state, (input) => ({ name: input.data.visible.name }));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		state.data.visible.name = "later";
		state.uiState.view.tab = 2;
		await Promise.resolve();
		expect(result.data).toEqual({ name: "Ada" });
		expect(result.uiState).toEqual({ view: { tab: 1 } });
		expect(Object.isFrozen(result.data)).toBe(true);
	});
});
