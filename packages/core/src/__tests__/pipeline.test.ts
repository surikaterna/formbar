import { describe, expect, it, vi } from "vitest";
import type { Middleware, ValidatorFn } from "../contracts.js";
import { createForm } from "../create-form.js";
import { executeSubmitPreparation } from "../pipeline.js";
import type { FormPlugin } from "../plugin-types.js";
import type { ValidationIssue } from "../state.js";
import { FormStore } from "../store.js";
import type { TransformDefinition } from "../transforms.js";

function createTracingMiddleware(log: string[]): Middleware {
	return {
		id: "tracer",
		beforeAction: (ctx) => {
			log.push(`beforeAction:${ctx.action.type}`);
			return { action: "continue" };
		},
		afterAction: (ctx) => {
			log.push(`afterAction:${ctx.action.type}`);
		},
		beforeEvaluate: (ctx) => {
			log.push(`beforeEvaluate:${ctx.action.type}`);
		},
		afterEvaluate: (ctx) => {
			log.push(`afterEvaluate:${ctx.action.type}`);
		},
		beforeValidate: (ctx) => {
			log.push(`beforeValidate:${ctx.stage ?? "none"}`);
		},
		afterValidate: (ctx) => {
			log.push(`afterValidate:issues=${ctx.issues.length}`);
		},
		beforeSubmit: (ctx) => {
			log.push(`beforeSubmit:${ctx.submitContext.requestId}`);
			return { action: "continue" };
		},
		afterSubmit: (ctx) => {
			log.push(`afterSubmit:ok=${ctx.result.ok}`);
		},
	};
}

describe("pipeline — 18-step engine", () => {
	it("set-value goes through all middleware hooks in order", () => {
		const log: string[] = [];
		const mw = createTracingMiddleware(log);
		const form = createForm({
			middleware: [mw],
			initialData: { name: "" },
		});

		form.setValue("name", "Alice");

		expect(log).toEqual([
			"beforeAction:set-value",
			"beforeEvaluate:set-value",
			"afterEvaluate:set-value",
			"beforeValidate:none",
			"afterValidate:issues=0",
			"afterAction:set-value",
		]);
		expect((form.getState().data as Record<string, unknown>).name).toBe("Alice");
	});

	it("middleware beforeAction veto rolls back transaction", () => {
		const vetoMw: Middleware = {
			id: "veto",
			beforeAction: () => ({ action: "veto", reason: "blocked" }),
		};
		const form = createForm({
			middleware: [vetoMw],
			initialData: { name: "original" },
		});

		const result = form.setValue("name", "changed");

		expect(result.ok).toBe(false);
		expect(result.error).toBe("blocked");
		// State unchanged — rollback
		expect((form.getState().data as Record<string, unknown>).name).toBe("original");
	});

	it("middleware beforeSubmit veto rolls back", async () => {
		const vetoMw: Middleware = {
			id: "submit-veto",
			beforeSubmit: () => ({ action: "veto", reason: "not ready" }),
		};
		const onSubmit = vi.fn().mockResolvedValue({ ok: true, submitId: "x" });
		const form = createForm({
			middleware: [vetoMw],
			onSubmit,
		});

		const result = await form.submit();

		expect(result.ok).toBe(false);
		expect(result.message).toBe("not ready");
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("validators produce issues that are normalized and stored", () => {
		const validator: ValidatorFn = ({ stage }) => [
			{
				code: "required",
				message: "Name is required",
				severity: "error",
				...(stage !== undefined ? { stage } : {}),
				path: { namespace: "data", segments: ["name"] },
				source: { origin: "function-validator", validatorId: "test-validator" },
			},
		];
		const form = createForm({
			validators: [validator],
			initialData: { name: "" },
		});

		form.setValue("name", "");

		const state = form.getState();
		expect(state.issues.length).toBe(1);
		expect(state.issues[0].code).toBe("required");
	});

	it("expression evaluation runs in the pipeline", () => {
		const form = createForm({
			plugins: [
				{
					id: "test-compute",
					evaluate: () => ({
						writes: [{ path: "computed", value: 42, mode: "set" as const }],
					}),
				},
			],
			initialData: { name: "", computed: 0 },
		});

		form.setValue("name", "trigger");

		expect((form.getState().data as Record<string, unknown>).computed).toBe(42);
	});

	it("transform application (ingress + field)", () => {
		const transforms: TransformDefinition[] = [
			{
				id: "trim",
				phase: "ingress",
				transform: (value) => (typeof value === "string" ? value.trim() : value),
			},
			{
				id: "upper",
				phase: "field",
				transform: (value) => (typeof value === "string" ? value.toUpperCase() : value),
			},
		];
		const form = createForm({
			transforms,
			initialData: { name: "" },
		});

		form.setValue("name", "  hello  ");

		expect((form.getState().data as Record<string, unknown>).name).toBe("HELLO");
	});

	it("submit succeeds and updates meta on success", async () => {
		const form = createForm({
			onSubmit: async () => ({ ok: true, submitId: "test" }),
		});

		const result = await form.submit();

		expect(result.ok).toBe(true);
		expect(form.getState().meta.submission?.status).toBe("succeeded");
	});

	it("full action→commit cycle integration", () => {
		const log: string[] = [];
		const mw = createTracingMiddleware(log);
		const listener = vi.fn();
		const form = createForm({
			middleware: [mw],
			initialData: { x: 0 },
		});
		form.subscribe(listener);

		const result = form.dispatch({ type: "set-value", path: "x", value: 99 });

		expect(result.ok).toBe(true);
		expect((form.getState().data as Record<string, unknown>).x).toBe(99);
		// Subscriber notified (step 16)
		expect(listener).toHaveBeenCalledTimes(1);
		// All hooks fired
		expect(log.length).toBeGreaterThan(0);
		expect(log[0]).toBe("beforeAction:set-value");
		expect(log[log.length - 1]).toBe("afterAction:set-value");
	});

	it("all-or-nothing: error during pipeline rolls back", () => {
		// Use a veto hook (beforeAction) that throws to trigger rollback,
		// since notify hooks (beforeEvaluate) now swallow errors for reliability
		const badMw: Middleware = {
			id: "crasher",
			beforeAction: () => {
				throw new Error("boom");
			},
		};
		const form = createForm({
			middleware: [badMw],
			initialData: { x: "safe" },
		});

		const result = form.setValue("x", "danger");

		expect(result.ok).toBe(false);
		// Throwing veto hook is treated as veto
		expect((form.getState().data as Record<string, unknown>).x).toBe("safe");
	});

	it("multiple middleware run in registration order", () => {
		const log: string[] = [];
		const mw1: Middleware = {
			id: "first",
			beforeAction: () => {
				log.push("first");
				return { action: "continue" };
			},
		};
		const mw2: Middleware = {
			id: "second",
			beforeAction: () => {
				log.push("second");
				return { action: "continue" };
			},
		};
		const form = createForm({
			middleware: [mw1, mw2],
			initialData: { x: 0 },
		});

		form.setValue("x", 1);

		expect(log).toEqual(["first", "second"]);
	});

	it("submit pipeline calls afterSubmit hook", async () => {
		const log: string[] = [];
		const mw = createTracingMiddleware(log);
		const form = createForm({
			middleware: [mw],
			onSubmit: async () => ({ ok: true, submitId: "test" }),
		});

		await form.submit();

		expect(log.some((l) => l.startsWith("beforeSubmit:"))).toBe(true);
		expect(log).toContain("afterSubmit:ok=true");
	});

	it("preserves the exact default submit hook and validator order", async () => {
		const log: string[] = [];
		const form = createForm({
			initialData: { value: 1 },
			middleware: [createTracingMiddleware(log)],
			validators: [
				() => {
					log.push("validator");
					return [];
				},
			],
			onSubmit: async () => {
				log.push("handler");
				return { ok: true, submitId: "done" };
			},
		});
		log.length = 0;
		await form.submit({ requestId: "trace" });
		expect(log).toEqual([
			"beforeAction:submit",
			"beforeEvaluate:submit",
			"afterEvaluate:submit",
			"beforeValidate:none",
			"validator",
			"afterValidate:issues=0",
			"beforeSubmit:trace",
			"afterAction:submit",
			"handler",
			"afterSubmit:ok=true",
		]);
	});

	it("validator issues block submit", async () => {
		const validator: ValidatorFn = () => [
			{
				code: "required",
				message: "Required",
				severity: "error",
				stage: "draft",
				path: { namespace: "data" as const, segments: ["x"] },
				source: { origin: "function-validator" as const, validatorId: "blocker" },
			},
		];
		const onSubmit = vi.fn().mockResolvedValue({ ok: true, submitId: "x" });
		const form = createForm({
			validators: [validator],
			onSubmit,
		});

		const result = await form.submit();

		expect(result.ok).toBe(false);
		expect(result.message).toBe("Validation failed");
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("throws FORMBAR_ASYNC_IN_SYNC_PIPELINE when validator returns Promise in dispatch", () => {
		const asyncValidator: ValidatorFn = () => Promise.resolve([]) as unknown as readonly ValidationIssue[];

		const form = createForm({
			validators: [asyncValidator],
		});

		const result = form.dispatch({ type: "set-value", path: "name", value: "test" });
		expect(result.ok).toBe(false);
		expect(result.error).toContain("returned a Promise in synchronous pipeline");
	});

	it("throws FORMBAR_ASYNC_IN_SYNC_PIPELINE when validator returns Promise in validate()", () => {
		const asyncValidator: ValidatorFn = () => Promise.resolve([]) as unknown as readonly ValidationIssue[];

		const form = createForm({
			validators: [asyncValidator],
		});

		expect(() => form.validate()).toThrow("returned a Promise in synchronous validate");
	});
});

describe("internal submit preparation (not reachable via createForm)", () => {
	const retained: ValidationIssue = {
		code: "RETAINED",
		message: "Keep",
		severity: "error",
		path: { namespace: "data", segments: ["value"] },
		source: { origin: "function-validator", validatorId: "old" },
	};

	function setup(log: string[], middleware: Middleware[] = []) {
		const seed = createForm({ initialData: { value: 1, computed: 0 } });
		const store = new FormStore(seed.getState());
		const tx = store.beginTransaction();
		tx.mutate((state) => ({ ...state, issues: [retained] }));
		store.commitTransaction(tx);
		seed.dispose();
		const plugins: FormPlugin[] = [
			{
				id: "compute",
				evaluate: () => {
					log.push("evaluate");
					return { writes: [{ path: "computed", value: 42, mode: "set" }] };
				},
			},
		];
		const validators: ValidatorFn[] = [
			() => {
				log.push("validator");
				return [];
			},
		];
		const ctx = {
			action: { type: "submit" as const },
			store,
			isSubmit: true,
			submitContext: { requestId: "trace", at: "now" },
			options: { middleware, validators },
			plugins,
		};
		return { store, ctx };
	}

	function guard(signal = new AbortController().signal, externalRevision = () => 0) {
		let owned = 0;
		return {
			signal,
			expectedRevision: 0,
			revision: () => owned + externalRevision(),
			onCommittedMutation: () => {
				owned++;
			},
		};
	}

	it("commits evaluate writes, preserves draft issues, and defers sync validation hooks", () => {
		const log: string[] = [];
		const { store, ctx } = setup(log, [createTracingMiddleware(log)]);
		const result = executeSubmitPreparation(ctx, guard());
		expect(result.stage).toBe("prepared");
		if (result.stage !== "prepared") return;
		expect(result.snapshot).toBe(store.getState());
		expect(result.revision).toBe(1);
		expect(result.snapshot.data).toEqual({ value: 1, computed: 42 });
		expect(result.snapshot.issues).toEqual([retained]);
		expect(log).toEqual([
			"beforeAction:submit",
			"beforeEvaluate:submit",
			"evaluate",
			"afterEvaluate:submit",
			"beforeSubmit:trace",
			"afterAction:submit",
		]);
	});

	it.each(["beforeAction", "beforeSubmit"] as const)(
		"%s veto rolls back plugin writes and skips candidate stage",
		(hook) => {
			const log: string[] = [];
			const middleware: Middleware = { id: "stop", [hook]: () => ({ action: "veto", reason: "stop" }) };
			const { store, ctx } = setup(log, [middleware, createTracingMiddleware(log)]);
			const before = store.getState();
			const result = executeSubmitPreparation(ctx, guard());
			expect(result).toEqual({ stage: "rejected", result: { ok: false, vetoed: true, vetoReason: "stop" } });
			expect(store.getState()).toBe(before);
			expect(log).not.toContain("validator");
			expect(log).not.toContain("afterAction:submit");
		},
	);

	it("plugin exception rolls back; subsequent preparation can commit", () => {
		const log: string[] = [];
		const { store, ctx } = setup(log);
		const before = store.getState();
		const failing = {
			...ctx,
			plugins: [
				{
					id: "fail",
					evaluate: () => {
						throw new Error("plugin failed");
					},
				},
			],
		};
		expect(executeSubmitPreparation(failing, guard())).toEqual({
			stage: "rejected",
			result: { ok: false, error: "plugin failed" },
		});
		expect(store.getState()).toBe(before);
		expect(executeSubmitPreparation(ctx, guard()).stage).toBe("prepared");
	});

	it("rejects missing submit context and leaves the store untouched", () => {
		const log: string[] = [];
		const { store, ctx } = setup(log);
		const before = store.getState();
		expect(executeSubmitPreparation({ ...ctx, submitContext: undefined }, guard()).stage).toBe("rejected");
		expect(store.getState()).toBe(before);
		expect(log).toEqual([]);
	});

	it("abort or reset revision before entry returns without evaluating", () => {
		const log: string[] = [];
		const { store, ctx } = setup(log);
		const before = store.getState();
		const controller = new AbortController();
		controller.abort();
		expect(executeSubmitPreparation(ctx, guard(controller.signal))).toEqual({
			stage: "rejected",
			result: { ok: false, error: "Submit preparation aborted" },
		});
		expect(
			executeSubmitPreparation(
				ctx,
				guard(undefined, () => 1),
			),
		).toEqual({
			stage: "rejected",
			result: { ok: false, error: "Submit preparation superseded" },
		});
		expect(store.getState()).toBe(before);
		expect(log).toEqual([]);
	});

	it("abort and reset during evaluation roll back all plugin writes and skip afterAction", () => {
		for (const mode of ["abort", "reset"] as const) {
			const log: string[] = [];
			const controller = new AbortController();
			let revision = 0;
			const { store, ctx } = setup(log, [
				{
					id: "interrupt",
					beforeSubmit: () => {
						if (mode === "abort") controller.abort();
						else revision++;
						return { action: "continue" };
					},
				},
				createTracingMiddleware(log),
			]);
			const before = store.getState();
			const result = executeSubmitPreparation(
				ctx,
				guard(controller.signal, () => revision),
			);
			expect(result.stage).toBe("rejected");
			expect(store.getState()).toBe(before);
			expect(log).toContain("evaluate");
			expect(log).not.toContain("validator");
			expect(log).not.toContain("afterAction:submit");
		}
	});

	it("reset from afterAction rejects the handoff after the committed notification", () => {
		const log: string[] = [];
		let revision = 0;
		const { store, ctx } = setup(log, [
			{
				id: "reset",
				afterAction: () => {
					revision++;
				},
			},
		]);
		const result = executeSubmitPreparation(
			ctx,
			guard(undefined, () => revision),
		);
		expect(result).toEqual({ stage: "rejected", result: { ok: false, error: "Submit preparation superseded" } });
		expect(store.getState().data).toEqual({ value: 1, computed: 42 });
		expect(store.getState().issues).toEqual([retained]);
	});
});

describe("pipeline — arbiter write filtering on action path", () => {
	it("filters arbiter writes that target the same path as the user action", () => {
		const form = createForm({
			initialData: { qty: 0, total: 0 },
			arbiterRules: [
				{
					name: "resetQty",
					when: {},
					then: [{ $set: { qty: 0 } }],
				},
			],
		});
		form.setValue("qty", 10);
		expect((form.getState().data as Record<string, unknown>).qty).toBe(10);
		form.dispose();
	});
});
