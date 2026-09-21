import { describe, expect, it } from "vitest";
import type { Middleware, ValidatorFn } from "../contracts.js";
import { createForm } from "../create-form.js";
import type { FormState } from "../state.js";
import { FormStore } from "../store.js";

function makeState(data: unknown = {}): FormState {
	return {
		data,
		uiState: {},
		meta: { validation: {} },
		fieldMeta: {},
		fieldPolicy: [],
		issues: [],
	};
}

describe("reliability — subscriber error isolation", () => {
	it("throwing subscriber does not prevent other subscribers from being notified", () => {
		const store = new FormStore(makeState({ x: 0 }));
		const calls: string[] = [];

		store.subscribe(() => {
			calls.push("first");
		});
		store.subscribe(() => {
			throw new Error("boom");
		});
		store.subscribe(() => {
			calls.push("third");
		});

		const tx = store.beginTransaction();
		tx.mutate((s) => ({ ...s, data: { x: 1 } }));
		store.commitTransaction(tx);

		expect(calls).toEqual(["first", "third"]);
	});
});

describe("reliability — validation issues cleared between dispatches", () => {
	it("issues do not accumulate across dispatches", () => {
		let shouldFail = true;
		const validator: ValidatorFn = () => {
			if (!shouldFail) return [];
			return [
				{
					code: "required",
					message: "Required",
					severity: "error" as const,
					stage: "draft",
					path: { namespace: "data" as const, segments: ["name"] },
					source: { origin: "function-validator" as const, validatorId: "conditional" },
				},
			];
		};
		const form = createForm({
			validators: [validator],
			initialData: { name: "" },
		});

		// First dispatch — produces 1 issue
		form.setValue("name", "");
		expect(form.getState().issues.length).toBe(1);

		// Second dispatch — validator returns no issues; stale issues must be cleared
		shouldFail = false;
		form.setValue("name", "valid");
		expect(form.getState().issues.length).toBe(0);
	});
});

describe("reliability — sync notify hook error isolation", () => {
	it("throwing sync notify hook does not crash the pipeline", () => {
		const crashMw: Middleware = {
			id: "crasher",
			beforeEvaluate: () => {
				throw new Error("notify boom");
			},
		};
		const form = createForm({
			middleware: [crashMw],
			initialData: { x: 0 },
		});

		const result = form.setValue("x", 42);

		// Pipeline should succeed despite the throwing notify hook
		expect(result.ok).toBe(true);
		expect((form.getState().data as Record<string, unknown>).x).toBe(42);
	});

	it("throwing sync notify hook does not skip remaining hooks", () => {
		const calls: string[] = [];
		const crashMw: Middleware = {
			id: "crasher",
			afterAction: () => {
				throw new Error("boom");
			},
		};
		const trackerMw: Middleware = {
			id: "tracker",
			afterAction: () => {
				calls.push("tracker");
			},
		};
		const form = createForm({
			middleware: [crashMw, trackerMw],
			initialData: { x: 0 },
		});

		form.setValue("x", 1);
		expect(calls).toEqual(["tracker"]);
	});
});
