import { describe, expect, it, vi } from "vitest";
import { prepareScopedSyncHost } from "../../../declarative/src/scoped-sync-host.js";
import { validateFormDefinition } from "../../../declarative/src/validators/definition.js";
import { attemptCanSubmit, rebaseAttemptIssues, renderableIssues } from "../attempt-issues.js";
import type { Middleware, ValidatorFn } from "../contracts.js";
import { createForm } from "../create-form.js";
import { FormRuntime } from "../form-runtime.js";
import { validateGuardedSubmitCandidate } from "../guarded-submit-validation.js";
import { registerScopedSync, scopedCaptureCurrent } from "../internal/scoped-sync.js";
import { issueEmissionId } from "../issue-provenance.js";
import { FormStore } from "../store.js";
import { createValidationCoordinator } from "../validation-coordinator.js";
import { normalizeIssues } from "../validation.js";

const issue = (code: string) => ({
	code,
	message: code,
	severity: "error" as const,
	path: { namespace: "data" as const, segments: ["included"] },
	source: { origin: "function-validator" as const, validatorId: code },
});

function fixture(
	middleware: Middleware[] = [],
	validators: ValidatorFn[] = [],
	asyncValidators: {
		id: string;
		validate: (input: {
			data: unknown;
			uiState: unknown;
			signal: AbortSignal;
			stage?: string;
			context?: unknown;
		}) => Promise<ReturnType<typeof issue>[]>;
	}[] = [],
	keepForm = false,
) {
	const runtime = keepForm
		? new FormRuntime({ initialData: { hidden: "secret", included: "Ada" }, initialUiState: { tab: 1 } })
		: undefined;
	const form =
		runtime?.build() ?? createForm({ initialData: { hidden: "secret", included: "Ada" }, initialUiState: { tab: 1 } });
	const store = runtime
		? (runtime as unknown as { store: FormStore<{ hidden: string; included: string }, { tab: number }> }).store
		: new FormStore(form.getState());
	if (!keepForm) form.dispose();
	let revision = 0;
	let active = true;
	const controller = new AbortController();
	const coordinator = createValidationCoordinator({
		validators: asyncValidators,
		getState: () => store.getState(),
		updateState: (updater) => {
			const tx = store.beginTransaction();
			tx.mutate(updater);
			store.commitTransaction(tx);
		},
		validatorTimeout: 15,
	});
	const context = {
		action: { type: "submit" },
		store,
		isSubmit: true,
		submitContext: { requestId: "candidate", at: "now" },
		options: { middleware, validators },
	};
	const guard = {
		signal: controller.signal,
		expectedRevision: 0,
		revision: () => revision,
		onCommittedMutation: () => {
			revision++;
			coordinator.onMutation();
		},
		isActive: () => active,
	};
	const adapter = () => ({
		data: { included: "Ada" },
		witness: {
			kind: "omission" as const,
			omitted: [[{ kind: "key" as const, key: "hidden" }]],
			protected: [],
			rowAnchors: [],
		},
	});
	return {
		form,
		store,
		coordinator,
		context,
		guard,
		adapter,
		controller,
		stop: () => {
			active = false;
		},
		stale: () => {
			revision++;
			coordinator.onMutation();
		},
		run: (transforms: ((value: unknown) => unknown)[] = []) =>
			validateGuardedSubmitCandidate(context, guard, adapter, coordinator, "attempt", transforms),
	};
}

describe("internal final candidate validator orchestration", () => {
	it("forwards final candidate cancellation to a prepared authored definition host on the same form", async () => {
		const f = fixture([], [], [], true);
		const prepared = validateFormDefinition({
			version: 1,
			id: "authored",
			root: { type: "field", id: "included", widget: "text", binding: { namespace: "data", segments: ["included"] } },
		});
		if (!prepared.ok) throw new Error("Invalid authored definition");
		const observed: unknown[] = [];
		registerScopedSync(
			f.form,
			prepareScopedSyncHost(prepared.value, [
				{
					fieldId: "included",
					validate: (input) => {
						observed.push(input);
						return [{ code: "scoped", message: "scoped", severity: "error" }];
					},
				},
			]),
		);
		const result = await validateGuardedSubmitCandidate(
			f.context,
			f.guard,
			f.adapter,
			f.coordinator,
			"attempt",
			[(value) => ({ ...(value as object), included: "Grace" })],
			f.form,
		);
		expect(result).toMatchObject({ ok: false, code: "validation_failed" });
		expect(observed).toHaveLength(1);
		expect(observed[0]).toMatchObject({
			data: { included: "Grace" },
			uiState: { tab: 1 },
			context: { requestId: "candidate", at: "now" },
		});
		expect((observed[0] as { signal?: AbortSignal }).signal).toBe(f.controller.signal);
		expect(f.store.getState().attemptValidation?.issues[0]?.code).toBe("scoped");
		f.controller.abort();
		expect((observed[0] as { signal: AbortSignal }).signal.aborted).toBe(true);
		f.form.dispose();
		f.coordinator.dispose();
	});
	it("consumes an invalid scoped rejected Promise without unhandledRejection", async () => {
		const f = fixture([], [], [], true);
		registerScopedSync(f.form, {
			instances: () => ({
				current: () => true,
				fields: [
					{
						fieldId: "included",
						instanceKey: "included",
						binding: { namespace: "data", segments: ["included"] },
						validate: (() => Promise.reject(new Error("invalid async scoped result"))) as never,
					},
				],
			}),
		});
		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown) => unhandled.push(reason);
		process.on("unhandledRejection", onUnhandled);
		try {
			expect(
				await validateGuardedSubmitCandidate(f.context, f.guard, f.adapter, f.coordinator, "attempt", [], f.form),
			).toMatchObject({
				ok: false,
				code: "unsafe_candidate",
			});
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(unhandled).toEqual([]);
		} finally {
			process.off("unhandledRejection", onUnhandled);
			f.form.dispose();
			f.coordinator.dispose();
		}
	});
	it("runs bound scoped sync with legacy on final bytes and retains only the original certificate", async () => {
		const seen: unknown[] = [];
		const f = fixture(
			[],
			[
				({ data, context }) => {
					seen.push([data, context]);
					return [
						{ ...issue("same"), stage: "review", source: { origin: "function-validator", validatorId: "included" } },
					];
				},
			],
			[],
			true,
		);
		registerScopedSync(f.form, {
			instances: (form, capture) => ({
				current: () => scopedCaptureCurrent(form, capture),
				fields: [
					{
						fieldId: "included",
						instanceKey: "included",
						binding: { namespace: "data", segments: ["included"] },
						validate: (input) => {
							seen.push([input.data, input.uiState, input.stage, input.context]);
							return [{ code: "same", message: "same", severity: "error" }];
						},
					},
				],
			}),
		});
		const stageTx = f.store.beginTransaction();
		stageTx.mutate((state) => ({ ...state, meta: { ...state.meta, stage: "review" } }));
		f.store.commitTransaction(stageTx);
		const result = await validateGuardedSubmitCandidate(
			f.context,
			f.guard,
			f.adapter,
			f.coordinator,
			"attempt",
			[(value) => ({ ...(value as object), included: "Grace" })],
			f.form,
		);
		expect(result).toMatchObject({ ok: false, code: "validation_failed" });
		const issues = f.store.getState().attemptValidation?.issues ?? [];
		expect(f.form.getState()).toBe(f.store.getState());
		expect(issues).toHaveLength(2);
		expect(issues.filter((entry) => issueEmissionId(entry) !== undefined)).toHaveLength(1);
		const certified = issues.find((entry) => issueEmissionId(entry) !== undefined);
		if (!certified) throw new Error("Missing certified candidate issue");
		const unowned = issues.find((entry) => entry !== certified);
		if (!unowned) throw new Error("Missing unowned candidate issue");
		expect(issueEmissionId(unowned)).toBeUndefined();
		expect(issueEmissionId({ ...certified })).toBeUndefined();
		for (const order of [
			[certified, unowned, { ...certified }],
			[unowned, { ...certified }, certified],
		]) {
			const normalized = normalizeIssues(order);
			expect(normalized).toHaveLength(2);
			expect(normalized).toContain(certified);
			expect(normalized).toContain(unowned);
		}
		const rebased = rebaseAttemptIssues(f.store.getState());
		expect(rebased.attemptValidation?.issues).toContain(certified);
		expect(renderableIssues(rebased)).toContain(certified);
		expect(issueEmissionId(certified)).toBeDefined();
		expect(seen).toEqual([
			[{ included: "Grace" }, { requestId: "candidate", at: "now" }],
			[{ included: "Grace" }, { tab: 1 }, "review", { requestId: "candidate", at: "now" }],
		]);
		f.form.reset();
		expect(issueEmissionId(certified)).toBeUndefined();
		f.form.dispose();
		f.coordinator.dispose();
	});
	it("rejects scoped callback reentrancy on data, UI, reset, disposal, abort and revision changes", async () => {
		for (const kind of ["data", "ui", "reset", "dispose", "abort", "revision"] as const) {
			const f = fixture([], [], [], true);
			registerScopedSync(f.form, {
				instances: (form, capture) => ({
					current: () => scopedCaptureCurrent(form, capture),
					fields: [
						{
							fieldId: "included",
							instanceKey: "included",
							binding: { namespace: "data", segments: ["included"] },
							validate: () => {
								if (kind === "data") f.form.setValue("included", "changed");
								if (kind === "ui") f.form.setValue("$ui.tab", 2);
								if (kind === "reset") f.form.reset();
								if (kind === "dispose") f.form.dispose();
								if (kind === "abort") f.controller.abort();
								if (kind === "revision") f.stale();
								return [{ code: "same", message: "same", severity: "error" }];
							},
						},
					],
				}),
			});
			const result = await validateGuardedSubmitCandidate(
				f.context,
				f.guard,
				f.adapter,
				f.coordinator,
				"attempt",
				[],
				f.form,
			);
			expect(result.ok, kind).toBe(false);
			expect(f.store.getState().attemptValidation, kind).toBeUndefined();
			f.form.dispose();
			f.coordinator.dispose();
		}
	});
	it("runs hooks once and every sync and async validator over the exact post-egress bytes and captured UI despite sync errors", async () => {
		const trace: string[] = [];
		const check = (input: { data: unknown; uiState: unknown; stage?: string; context?: unknown }) => {
			expect(input.data).toEqual({ included: "Grace" });
			expect(input.uiState).toEqual({ tab: 1 });
			if (input.context) expect(input.context).toEqual({ requestId: "candidate", at: "now" });
			expect(input.stage).toBeUndefined();
			expect(JSON.stringify(input)).not.toContain("secret");
		};
		const f = fixture(
			[
				{
					id: "hooks",
					beforeValidate: ({ state }) => {
						trace.push("before");
						check(state);
					},
					afterValidate: ({ state, issues }) => {
						trace.push("after");
						expect(state.data).toEqual({ included: "Grace" });
						expect(issues).toHaveLength(2);
					},
				},
			],
			[
				...(["sync1", "sync2"] as const).map((name) => (input) => {
					trace.push(name);
					check(input);
					return [issue(name)];
				}),
			],
			[
				...(["async1", "async2"] as const).map((id) => ({
					id,
					validate: async (input) => {
						trace.push(id);
						check(input);
						return [issue(id)];
					},
				})),
			],
		);
		const retained = f.store.getState();
		const result = await f.run([
			(value) => {
				trace.push("egress");
				expect(value).toEqual({ included: "Ada" });
				return { included: "Grace" };
			},
		]);
		expect(result).toMatchObject({ ok: false, code: "validation_failed" });
		if ("fieldIssues" in result)
			expect(result.fieldIssues.map((i) => i.code)).toEqual(["async1", "async2", "sync1", "sync2"]);
		expect(trace).toEqual(["egress", "before", "sync1", "sync2", "after", "async1", "async2"]);
		expect(f.store.getState().issues).toEqual([]);
		expect(f.store.getState().attemptValidation?.issues.map((i) => i.code)).toEqual([
			"async1",
			"async2",
			"sync1",
			"sync2",
		]);
		expect(renderableIssues(f.store.getState()).map((i) => i.code)).toEqual(["async1", "async2", "sync1", "sync2"]);
		expect(f.store.getState().data).toEqual(retained.data);
		f.coordinator.dispose();
	});

	it("rejects hook reentrancy, tampering and zero-async stale without publishing", async () => {
		for (const kind of ["abort", "revision", "tamper"] as const) {
			const spy = vi.fn(() => [issue("sync")]);
			const f = fixture([], [spy]);
			f.context.options.middleware.push({
				id: kind,
				beforeValidate:
					kind === "abort"
						? () => f.controller.abort()
						: kind === "tamper"
							? ({ state }) => {
									(state as { data: unknown }).data = {};
								}
							: undefined,
				afterValidate: kind === "revision" ? () => f.stale() : undefined,
			});
			const result = await f.run();
			expect(result.ok).toBe(false);
			expect(f.store.getState().attemptValidation).toBeUndefined();
			f.coordinator.dispose();
		}
	});

	it("never publishes stale success after asynchronous abort or timeout", async () => {
		const f = fixture([], [], [{ id: "pending", validate: () => new Promise(() => {}) }]);
		const result = await f.run();
		expect(result.ok).toBe(false);
		expect(f.store.getState().attemptValidation).toBeUndefined();
		f.coordinator.dispose();
	});

	it("rejects reintroduced final bytes before any hook or validator", async () => {
		const hook = vi.fn();
		const validator = vi.fn(() => [issue("never")]);
		const f = fixture([{ id: "hook", beforeValidate: hook }], [validator]);
		const result = await f.run([() => ({ hidden: "secret", included: "Ada" })]);
		expect(result).toMatchObject({ ok: false });
		expect(hook).not.toHaveBeenCalled();
		expect(validator).not.toHaveBeenCalled();
		expect(f.store.getState().attemptValidation).toBeUndefined();
		f.coordinator.dispose();
	});

	it("cancels zero-async attempts reentered by a store listener", async () => {
		const f = fixture();
		const unsubscribe = f.store.subscribe((state) => {
			if (state.attemptValidation?.status === "running") f.stale();
		});
		expect(await f.run()).toMatchObject({ ok: false });
		expect(f.store.getState().attemptValidation).toBeUndefined();
		unsubscribe();
		f.coordinator.dispose();
	});

	it("passes the captured stage and submit context to sync and async validators with a no-op adapter", async () => {
		const observed: string[] = [];
		const check = (input: { data: unknown; uiState: unknown; stage?: string; context?: unknown }) => {
			expect(input.data).toEqual({ hidden: "secret", included: "Ada" });
			expect(input.uiState).toEqual({ tab: 1 });
			expect(input.stage).toBe("review");
			expect(input.context).toEqual({ requestId: "candidate", at: "now" });
		};
		const f = fixture(
			[],
			[
				(input) => {
					observed.push("sync");
					check(input);
					return [];
				},
			],
			[
				{
					id: "remote",
					validate: async (input) => {
						observed.push("async");
						check(input);
						return [];
					},
				},
			],
		);
		const tx = f.store.beginTransaction();
		tx.mutate((state) => ({ ...state, meta: { ...state.meta, stage: "review" } }));
		f.store.commitTransaction(tx);
		const noOp = (capture: { data: unknown }) => ({
			data: structuredClone(capture.data),
			witness: {
				kind: "no-omission" as const,
				omitted: [],
				protected: [],
				rowAnchors: [],
			},
		});
		const result = await validateGuardedSubmitCandidate(f.context, f.guard, noOp, f.coordinator, "attempt");
		expect(result).toMatchObject({ ok: true, issues: [] });
		expect(observed).toEqual(["sync", "async"]);
		f.coordinator.dispose();
	});

	it("does not skip validators when retained issues already block submission", async () => {
		const sync = vi.fn(() => [issue("fresh")]);
		const remote = vi.fn(async () => [issue("remote")]);
		const f = fixture([], [sync], [{ id: "remote", validate: remote }]);
		const tx = f.store.beginTransaction();
		tx.mutate((state) => ({
			...state,
			issues: [{ ...issue("retained"), source: { origin: "rule", validatorId: "rule" } }],
		}));
		f.store.commitTransaction(tx);
		expect(await f.run()).toMatchObject({ ok: false, code: "validation_failed" });
		expect(sync).toHaveBeenCalledTimes(1);
		expect(remote).toHaveBeenCalledTimes(1);
		expect(f.store.getState().issues.map((i) => i.code)).toEqual(["retained"]);
		expect(renderableIssues(f.store.getState()).map((i) => i.code)).toEqual(["retained", "fresh", "remote"]);
		expect(attemptCanSubmit(f.store.getState(), f.coordinator.revision())).toBe(false);
		f.coordinator.dispose();
	});

	it("keeps captured submit context identical across sync and async callbacks that try to mutate it", async () => {
		const seen: unknown[] = [];
		const f = fixture(
			[],
			[
				({ context }) => {
					seen.push(context);
					try {
						(context as { requestId: string }).requestId = "changed";
					} catch {
						/* frozen input */
					}
					return [];
				},
				({ context }) => {
					seen.push(context);
					return [];
				},
			],
			[
				{
					id: "remote",
					validate: async ({ context }) => {
						seen.push(context);
						try {
							(context as { requestId: string }).requestId = "remote-change";
						} catch {
							/* frozen input */
						}
						return [];
					},
				},
				{
					id: "remote2",
					validate: async ({ context }) => {
						seen.push(context);
						return [];
					},
				},
			],
		);
		expect(await f.run()).toMatchObject({ ok: true });
		expect(seen).toEqual(Array(4).fill({ requestId: "candidate", at: "now" }));
		expect(f.context.submitContext.requestId).toBe("candidate");
		f.coordinator.dispose();
	});

	it("never allows afterValidate to erase or rewrite canonical sync failures", async () => {
		const f = fixture(
			[
				{
					id: "hook",
					afterValidate: ({ issues }) => {
						try {
							(issues as ReturnType<typeof issue>[]).splice(0);
						} catch {
							/* frozen snapshot */
						}
						try {
							(issues[0] as { code: string }).code = "forged";
						} catch {
							/* frozen snapshot */
						}
					},
				},
			],
			[() => [issue("FAIL")]],
		);
		expect(await f.run()).toMatchObject({ ok: false, code: "validation_failed" });
		expect(f.store.getState().attemptValidation?.issues.map((i) => i.code)).toEqual(["FAIL"]);
		f.coordinator.dispose();
		const override = fixture(
			[{ id: "override", afterValidate: (() => []) as Middleware["afterValidate"] }],
			[() => [issue("FAIL")]],
		);
		expect(await override.run()).toMatchObject({ ok: false });
		expect(override.store.getState().attemptValidation).toBeUndefined();
		override.coordinator.dispose();
	});

	it("consumes rejected thenables from sync hooks and invalid sync validator returns", async () => {
		const unhandled = vi.fn();
		process.on("unhandledRejection", unhandled);
		try {
			for (const kind of ["before", "after", "validator"] as const) {
				const reject = () => Promise.reject(new Error(kind));
				const f = fixture(
					kind === "before"
						? [{ id: kind, beforeValidate: reject }]
						: kind === "after"
							? [{ id: kind, afterValidate: reject }]
							: [],
					kind === "validator" ? [reject as unknown as ValidatorFn] : [],
				);
				expect(await f.run()).toMatchObject({ ok: false });
				expect(f.store.getState().attemptValidation).toBeUndefined();
				f.coordinator.dispose();
			}
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(unhandled).not.toHaveBeenCalled();
		} finally {
			process.off("unhandledRejection", unhandled);
		}
	});

	it("reports async validator exceptions as failed attempts, and never invokes later validators after sync throws", async () => {
		const f = fixture(
			[],
			[],
			[
				{
					id: "throws",
					validate: async () => {
						throw new Error("remote down");
					},
				},
				{ id: "other", validate: async () => [issue("other")] },
			],
		);
		const result = await f.run();
		expect(result).toMatchObject({ ok: false, code: "validation_failed" });
		expect(f.store.getState().attemptValidation?.status).toBe("failed");
		expect(f.store.getState().attemptValidation?.issues.map((i) => i.code)).toEqual([
			"ASYNC_VALIDATOR_EXCEPTION",
			"other",
		]);
		f.coordinator.dispose();
		const next = vi.fn(() => []);
		const bad = fixture(
			[],
			[
				() => {
					throw new Error("bad sync");
				},
				next,
			],
		);
		expect(await bad.run()).toMatchObject({ ok: false });
		expect(next).not.toHaveBeenCalled();
		expect(bad.store.getState().attemptValidation).toBeUndefined();
		bad.coordinator.dispose();
	});
});
