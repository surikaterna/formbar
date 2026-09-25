import { describe, expect, it, vi } from "vitest";
import type { FormApi } from "../contracts.js";
import { observationContext, observationCurrent, observe } from "../scoped-async-observation.js";
import { ScopedAsyncScheduler } from "../scoped-async-scheduler.js";
import { type ScopedAsyncField, registerScopedAsync } from "../scoped-async.js";
import type { FormState, ValidationIssue } from "../state.js";

describe("scoped async observation ownership", () => {
	it("does not let an outer batched event schedule over a reentrant mutation", async () => {
		vi.useFakeTimers();
		type Data = { rows: { value: string }[] };
		let state = {
			data: { rows: [{ value: "a" }, { value: "b" }] },
			uiState: {},
			meta: { stage: undefined },
			issues: [] as readonly ValidationIssue[],
		} as FormState<Data, object>;
		const form = {
			getState: () => state,
			captureState: () => ({ state }),
			isDisposed: () => false,
		} as unknown as FormApi<Data, object>;
		const fields: ScopedAsyncField[] = [0, 1].map((index) => ({
			id: "scoped",
			fieldId: "value",
			instanceKey: `row:${index}`,
			binding: { namespace: "data", segments: ["rows", index, "value"] },
			trigger: "onChange",
			debounceMs: 0,
			validate: async () => [{ code: "bad", message: "bad", severity: "error" }],
		}));
		registerScopedAsync(form, { ids: new Set(["scoped"]), instances: () => ({ current: () => true, fields }) }, []);
		let reentered = false;
		const scheduler = new ScopedAsyncScheduler({
			form: () => form,
			revision: () => 0,
			updateState: (update) => {
				state = update(state);
				if (reentered || state.issues.length) return;
				reentered = true;
				state = { ...state, data: { rows: [{ value: "c" }, { value: "d" }] } };
				scheduler.onEvent({ namespace: "data", segments: ["rows"] }, "onChange");
			},
		});
		const foreground = scheduler.prepareForeground(undefined, new AbortController().signal);
		const originals = await foreground?.run();
		foreground?.stage().finish();
		state = { ...state, issues: originals ?? [], data: { rows: [{ value: "b" }, { value: "a" }] } };
		scheduler.onEvent({ namespace: "data", segments: ["rows"] }, "onChange");
		expect(reentered).toBe(true);
		expect(state.issues).toEqual([]);
		for (const original of originals ?? []) expect(state.issues).not.toContain(original);
		await vi.runAllTimersAsync();
		expect(state.issues).toHaveLength(2);
		scheduler.reset(true);
		vi.useRealTimers();
	});
	it("revokes only original certified issues, preserving an equal copied issue and unowned legacy", async () => {
		type Data = { rows: { value: string }[] };
		let state = {
			data: { rows: [{ value: "a" }, { value: "b" }] },
			uiState: {},
			fieldPolicy: {},
			meta: { stage: undefined },
			issues: [] as readonly ValidationIssue[],
		} as unknown as FormState<Data, object>;
		const form = {
			getState: () => state,
			captureState: () => ({ state }),
			isDisposed: () => false,
		} as unknown as FormApi<Data, object>;
		const fields: ScopedAsyncField[] = [0, 1].map((index) => ({
			id: "scoped",
			fieldId: "value",
			instanceKey: `row:${index}`,
			binding: { namespace: "data", segments: ["rows", index, "value"] },
			trigger: "onBlur",
			debounceMs: 0,
			validate: async () => [{ code: "same", message: "bad", severity: "error" }],
		}));
		registerScopedAsync(form, { ids: new Set(["scoped"]), instances: () => ({ current: () => true, fields }) }, []);
		const scheduler = new ScopedAsyncScheduler({
			form: () => form,
			revision: () => 0,
			updateState: (update) => {
				state = update(state);
			},
		});
		const foreground = scheduler.prepareForeground(undefined, new AbortController().signal);
		expect(foreground).toBeDefined();
		const originals = await foreground?.run();
		expect(originals).toHaveLength(2);
		const staged = foreground?.stage();
		const copied = { ...originals?.[0] } as ValidationIssue;
		const legacy = {
			...originals?.[0],
			source: { origin: "async-validator" as const, validatorId: "legacy" },
		} as ValidationIssue;
		state = { ...state, issues: [...(originals ?? []), copied, legacy] };
		staged?.finish();
		state = { ...state, data: { rows: [{ value: "b" }, { value: "a" }] } };
		scheduler.onEvent({ namespace: "data", segments: ["rows"] }, "onChange");
		expect(state.issues).toContain(copied);
		expect(state.issues).toContain(legacy);
		for (const issue of originals ?? []) expect(state.issues).not.toContain(issue);
		scheduler.reset(true);
	});
});

describe("bounded scoped async parent observation", () => {
	for (const count of [100, 300, 600]) {
		it(`shares parent snapshots and comparisons across ${count} nested rows`, () => {
			const data = { groups: [{ rows: Array.from({ length: count }, (_, index) => ({ value: String(index) })) }] };
			const fields: ScopedAsyncField[] = Array.from({ length: count }, (_, index) => ({
				id: "scoped",
				fieldId: "value",
				instanceKey: `group:0:row:${index}`,
				binding: { namespace: "data", segments: ["groups", 0, "rows", index, "value"] },
				trigger: "onBlur",
				debounceMs: 0,
				validate: async () => [{ code: "bad", message: "bad", severity: "error" }],
			}));
			const clone = vi.spyOn(globalThis, "structuredClone");
			try {
				const context = observationContext();
				const observations = fields.map((field) => observe(field, data, context));
				const rows = data.groups[0].rows;
				expect(clone.mock.calls.filter(([value]) => value === rows)).toHaveLength(1);
				const keys = vi.spyOn(Reflect, "ownKeys");
				try {
					const compared = new Map<object, boolean>();
					expect(observations.every((item) => observationCurrent(item, data, compared))).toBe(true);
					expect(keys.mock.calls.filter(([value]) => value === rows)).toHaveLength(2);
				} finally {
					keys.mockRestore();
				}
				const replacement = {
					groups: [{ rows: Array.from({ length: count }, (_, index) => ({ value: String(index) })) }],
				};
				const replaced = new Map<object, boolean>();
				expect(observations.every((item) => !observationCurrent(item, replacement, replaced))).toBe(true);
				data.groups[0].rows[0].value = "changed";
				const mutated = new Map<object, boolean>();
				expect(observations.every((item) => !observationCurrent(item, data, mutated))).toBe(true);
			} finally {
				clone.mockRestore();
			}
		});
	}
});
