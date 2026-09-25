import { describe, expect, it } from "vitest";
import type { Middleware } from "../contracts.js";
import { createForm } from "../create-form.js";
import { executeSubmitPreparation } from "../pipeline.js";
import type { FormPlugin } from "../plugin-types.js";
import { FormStore } from "../store.js";

function fixture(middleware: Middleware[] = [], plugins: FormPlugin[] = []) {
	const form = createForm({ initialData: { value: 1 }, initialUiState: { open: false } });
	const store = new FormStore(form.getState());
	form.dispose();
	let revision = 0;
	let notifications = 0;
	const controller = new AbortController();
	const ctx = {
		action: { type: "submit" as const },
		store,
		isSubmit: true,
		submitContext: { requestId: "test", at: "now" },
		options: { middleware },
		plugins,
	};
	const guard = {
		signal: controller.signal,
		expectedRevision: 0,
		revision: () => revision,
		onCommittedMutation: () => {
			revision++;
			notifications++;
		},
	};
	return {
		store,
		ctx,
		guard,
		controller,
		get counts() {
			return { revision, notifications };
		},
		reset: () => {
			revision++;
		},
		mutate: (data = false) => {
			const tx = store.beginTransaction();
			tx.mutate((state) => (data ? { ...state, data: { value: 99 } } : { ...state, uiState: { open: true } }));
			store.commitTransaction(tx);
			revision++;
		},
	};
}

describe("guarded preparation checkpoints", () => {
	it("counts the owned commit before the first afterAction, once, and preserves retained references", () => {
		const f = fixture([], [{ id: "write", evaluate: () => ({ writes: [{ path: "value", value: 2, mode: "set" }] }) }]);
		const before = f.store.getState();
		const seen: number[] = [];
		f.ctx.options.middleware.push({
			id: "observe",
			afterAction: () => {
				seen.push(f.counts.revision);
			},
		});
		const result = executeSubmitPreparation(f.ctx, f.guard);
		expect(result.stage).toBe("prepared");
		if (result.stage === "prepared") expect(result.revision).toBe(1);
		expect(seen).toEqual([1]);
		expect(f.counts).toEqual({ revision: 1, notifications: 1 });
		expect(before.data).toEqual({ value: 1 });
		expect(Object.isFrozen(before.data)).toBe(false);
	});

	it("does not count metadata-only commits or vetoed plugin writes", () => {
		const f = fixture();
		expect(executeSubmitPreparation(f.ctx, f.guard).stage).toBe("prepared");
		expect(f.counts).toEqual({ revision: 0, notifications: 0 });
		const veto = fixture(
			[{ id: "stop", beforeSubmit: () => ({ action: "veto", reason: "stop" }) }],
			[{ id: "write", evaluate: () => ({ writes: [{ path: "value", value: 2, mode: "set" }] }) }],
		);
		const before = veto.store.getState();
		expect(executeSubmitPreparation(veto.ctx, veto.guard).stage).toBe("rejected");
		expect(veto.store.getState()).toBe(before);
		expect(veto.counts.notifications).toBe(0);
	});

	it.each(["beforeAction", "beforeSubmit", "beforeEvaluate", "afterEvaluate"] as const)(
		"stops after %s reentrancy, including swallowed throws",
		(hook) => {
			const trace: string[] = [];
			const f = fixture();
			f.ctx.options.middleware.push(
				{
					id: "interrupt",
					[hook]: () => {
						f.controller.abort();
						throw new Error("interrupted");
					},
				},
				{
					id: "next",
					[hook]: () => {
						trace.push("next");
					},
				},
			);
			const before = f.store.getState();
			expect(executeSubmitPreparation(f.ctx, f.guard).stage).toBe("rejected");
			expect(trace).toEqual([]);
			expect(f.store.getState()).toBe(before);
		},
	);

	it("stops plugin evaluation after a reset revision, without committing", () => {
		const trace: string[] = [];
		const f = fixture();
		f.ctx.plugins.push(
			{
				id: "reset",
				evaluate: () => {
					f.controller.abort();
					return undefined;
				},
			},
			{
				id: "later",
				evaluate: () => {
					trace.push("later");
					return undefined;
				},
			},
		);
		const before = f.store.getState();
		expect(executeSubmitPreparation(f.ctx, f.guard).stage).toBe("rejected");
		expect(trace).toEqual([]);
		expect(f.store.getState()).toBe(before);
	});

	it.each(["data", "ui", "abort", "reset"] as const)("stops subsequent afterAction on %s reentrancy", (mode) => {
		const trace: string[] = [];
		const f = fixture([], [{ id: "write", evaluate: () => ({ writes: [{ path: "value", value: 2, mode: "set" }] }) }]);
		f.ctx.options.middleware.push(
			{
				id: "first",
				afterAction: () => {
					if (mode === "abort") f.controller.abort();
					else if (mode === "reset") f.reset();
					else f.mutate(mode === "data");
				},
			},
			{
				id: "second",
				afterAction: () => {
					trace.push("second");
				},
			},
		);
		const result = executeSubmitPreparation(f.ctx, f.guard);
		expect(result.stage).toBe("rejected");
		expect(trace).toEqual([]);
		expect(f.counts.notifications).toBe(1);
		expect(f.store.getState().data).toEqual({ value: mode === "data" ? 99 : 2 });
	});

	it("checks subscriber reentrancy before afterAction and never rebaselines it", () => {
		const f = fixture([], [{ id: "write", evaluate: () => ({ writes: [{ path: "value", value: 2, mode: "set" }] }) }]);
		const trace: string[] = [];
		let once = true;
		f.store.subscribe(() => {
			if (once) {
				once = false;
				f.mutate();
			}
		});
		f.ctx.options.middleware.push({
			id: "after",
			afterAction: () => {
				trace.push("after");
			},
		});
		expect(executeSubmitPreparation(f.ctx, f.guard).stage).toBe("rejected");
		expect(trace).toEqual([]);
		expect(f.counts).toEqual({ revision: 2, notifications: 1 });
	});
});
