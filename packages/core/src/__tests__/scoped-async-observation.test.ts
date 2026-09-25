import { describe, expect, it } from "vitest";
import type { FormApi } from "../contracts.js";
import { ScopedAsyncScheduler } from "../scoped-async-scheduler.js";
import { type ScopedAsyncField, registerScopedAsync } from "../scoped-async.js";
import type { FormState, ValidationIssue } from "../state.js";

describe("scoped async observation ownership", () => {
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
