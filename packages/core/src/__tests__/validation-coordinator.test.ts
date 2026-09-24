import { describe, expect, it, vi } from "vitest";
import type { AsyncValidatorConfig } from "../contracts.js";
import { createForm } from "../create-form.js";
import type { FormState } from "../state.js";
import type { ValidationIssue } from "../state.js";
import { createValidationCoordinator } from "../validation-coordinator.js";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((onResolve, onReject) => {
		resolve = onResolve;
		reject = onReject;
	});
	return { promise, resolve, reject };
}

function issue(code: string, path = "name"): ValidationIssue {
	return {
		code,
		message: code,
		severity: "error",
		path: { namespace: "data", segments: path.split(".") },
		source: { origin: "rule", validatorId: "untrusted" },
	};
}

function candidateHarness(
	validators: readonly AsyncValidatorConfig<{ name: string }, { step: number }>[],
	timeout?: number,
) {
	const form = createForm({ initialData: { name: "draft" }, initialUiState: { step: 1 } });
	let state: FormState<{ name: string }, { step: number }> = {
		...form.getState(),
		issues: [issue("retained")],
	};
	const coordinator = createValidationCoordinator({
		validators,
		validatorTimeout: timeout,
		getState: () => state,
		updateState: (update) => {
			state = update(state);
		},
	});
	return {
		coordinator,
		getState: () => state,
		resetState: () => {
			state = {
				...state,
				meta: { ...state.meta, validation: { ...state.meta.validation, validating: false } },
				fieldMeta: {},
			};
		},
	};
}

describe("candidate-only foreground async validation", () => {
	it("runs every validator on the candidate with stage/context, normalizes results, and preserves draft issues", async () => {
		const inputs: unknown[] = [];
		const validators: AsyncValidatorConfig<{ name: string }, { step: number }>[] = [
			{
				id: "blur",
				trigger: "onBlur",
				fields: ["name"],
				validate: async ({ data, uiState, stage, context }) => {
					inputs.push({ data, uiState, stage, context });
					return [issue("candidate")];
				},
			},
			{ id: "form", validate: async () => [issue("second")] },
		];
		const { coordinator, getState } = candidateHarness(validators);
		const before = getState().issues;
		const context = { requestId: "request", at: "2026-09-24T00:00:00Z" };
		const result = await coordinator.validateCandidate(
			{ data: { name: "outgoing" }, uiState: { step: 2 } },
			coordinator.revision(),
			undefined,
			{ stage: "submit", context },
		);
		expect(inputs).toEqual([{ data: { name: "outgoing" }, uiState: { step: 2 }, stage: "submit", context }]);
		expect(result.status).toBe("completed");
		expect(result.issues.map((entry) => entry.source)).toEqual([
			{ origin: "async-validator", validatorId: "blur" },
			{ origin: "async-validator", validatorId: "form" },
		]);
		expect(getState().issues).toBe(before);
		expect(getState().meta.validation.validating).toBe(false);
	});

	it("contains exceptions without replacing the retained lane", async () => {
		const { coordinator, getState } = candidateHarness([
			{
				id: "broken",
				validate: async () => {
					throw new Error("broken");
				},
			},
		]);
		const result = await coordinator.validateCandidate({ data: { name: "x" }, uiState: { step: 1 } }, 0);
		expect(result.issues).toMatchObject([{ code: "ASYNC_VALIDATOR_EXCEPTION", message: "broken" }]);
		expect(getState().issues.map((entry) => entry.code)).toEqual(["retained"]);
	});

	it("leaves legacy foreground publishing and validator input defaults unchanged", async () => {
		const inputs: unknown[] = [];
		const { coordinator, getState } = candidateHarness([
			{
				id: "legacy",
				validate: async (input) => {
					inputs.push(input);
					return [issue("legacy")];
				},
			},
		]);
		const result = await coordinator.validateSnapshot({ data: { name: "draft" }, uiState: { step: 1 } }, 0);
		expect(result.issues[0]?.code).toBe("legacy");
		expect(getState().issues.map((entry) => entry.code)).toEqual(["legacy", "retained"]);
		expect(inputs).toMatchObject([{ data: { name: "draft" }, uiState: { step: 1 } }]);
		expect(Object.keys(inputs[0] as object)).toEqual(["data", "uiState", "signal"]);
	});

	it("bounds ignored signals and ignores late completions after timeout", async () => {
		vi.useFakeTimers();
		try {
			const pending = deferred<readonly ValidationIssue[]>();
			let validatorSignal: AbortSignal | undefined;
			const { coordinator, getState } = candidateHarness(
				[
					{
						id: "slow",
						fields: ["name"],
						validate: ({ signal }) => {
							validatorSignal = signal;
							return pending.promise;
						},
					},
				],
				20,
			);
			const run = coordinator.validateCandidate({ data: { name: "x" }, uiState: { step: 1 } }, 0);
			expect(getState().meta.validation.validating).toBe(true);
			expect(getState().fieldMeta.name?.isValidating).toBe(true);
			await vi.advanceTimersByTimeAsync(20);
			expect(await run).toEqual({ status: "aborted", issues: [] });
			expect(validatorSignal?.aborted).toBe(true);
			pending.resolve([issue("late")]);
			await Promise.resolve();
			expect(getState().issues.map((entry) => entry.code)).toEqual(["retained"]);
			expect(getState().meta.validation.validating).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it.each(["signal", "mutation", "reset", "dispose", "supersede"] as const)(
		"cancels abort-ignoring work on %s without stale writes",
		async (cause) => {
			const pending = deferred<readonly ValidationIssue[]>();
			const controller = new AbortController();
			const { coordinator, getState, resetState } = candidateHarness([
				{ id: "slow", fields: ["name"], validate: () => pending.promise },
			]);
			const snapshot = { data: { name: "x" }, uiState: { step: 1 } };
			const run = coordinator.validateCandidate(snapshot, 0, controller.signal);
			if (cause === "signal") controller.abort();
			if (cause === "mutation") coordinator.onMutation();
			if (cause === "reset") {
				coordinator.reset();
				resetState();
			}
			if (cause === "dispose") coordinator.dispose();
			if (cause === "supersede") {
				const next = coordinator.validateCandidate(snapshot, 0);
				expect(getState().meta.validation.validating).toBe(true);
				coordinator.reset();
				resetState();
				expect((await next).status).toBe("aborted");
			}
			expect(await run).toEqual({
				status: cause === "mutation" || cause === "supersede" ? "superseded" : "aborted",
				issues: [],
			});
			pending.resolve([issue("late")]);
			await Promise.resolve();
			expect(getState().issues.map((entry) => entry.code)).toEqual(["retained"]);
			expect(getState().meta.validation.validating).toBe(false);
			expect(getState().fieldMeta.name?.isValidating ?? false).toBe(false);
		},
	);

	it("checks abort, revision and disposal even without validators", async () => {
		const { coordinator } = candidateHarness([]);
		const snapshot = { data: { name: "x" }, uiState: { step: 1 } };
		const controller = new AbortController();
		controller.abort();
		expect((await coordinator.validateCandidate(snapshot, 0, controller.signal)).status).toBe("aborted");
		expect((await coordinator.validateSnapshot(snapshot, 0, controller.signal)).status).toBe("completed");
		coordinator.onMutation();
		expect((await coordinator.validateCandidate(snapshot, 0)).status).toBe("superseded");
		coordinator.dispose();
		expect((await coordinator.validateCandidate(snapshot, coordinator.revision())).status).toBe("aborted");
	});
});

describe("validateAsync selection and ownership", () => {
	it("selects exact, ancestor, and descendant fields while form-level validators stay unscoped", async () => {
		const calls: string[] = [];
		const validator = (id: string, fields?: AsyncValidatorConfig["fields"]): AsyncValidatorConfig => ({
			id,
			fields,
			validate: async () => {
				calls.push(id);
				return [];
			},
		});
		const form = createForm({
			initialData: { user: { name: "" }, other: "" },
			asyncValidators: [
				validator("ancestor", ["user"]),
				validator("exact", ["user.name"]),
				validator("descendant", ["user.name.first"]),
				validator("other", ["other"]),
				validator("form"),
			],
		});

		expect(await form.validateAsync("user.name")).toEqual({ status: "completed", issues: [] });
		expect(calls).toEqual(["ancestor", "exact", "descendant"]);
		calls.length = 0;
		await form.validateAsync();
		expect(calls).toEqual(["ancestor", "exact", "descendant", "other", "form"]);
	});

	it("does not churn validation status when a scope selects no validators", async () => {
		const form = createForm({
			initialData: { name: "" },
			asyncValidators: [{ id: "name", fields: ["name"], validate: async () => [] }],
		});
		const listener = vi.fn();
		form.subscribe(listener);

		expect(await form.validateAsync("other")).toEqual({ status: "completed", issues: [] });
		expect(listener).not.toHaveBeenCalled();
		expect(form.getState().meta.validation.validating).toBe(false);
	});

	it("uses unique IDs for lanes while duplicate labels remain valid", async () => {
		const form = createForm({
			asyncValidators: [
				{ id: "one", label: "duplicate", validate: async () => [] },
				{ id: "two", label: "duplicate", validate: async () => [] },
			],
		});
		expect((await form.validateAsync()).status).toBe("completed");
		expect(() =>
			createForm({
				asyncValidators: [
					{ id: "same", validate: async () => [] },
					{ id: "same", validate: async () => [] },
				],
			}),
		).toThrow("Async validator id must be unique");
	});

	it("canonicalizes issue ownership and replaces only the current validator issues deterministically", async () => {
		let code = "second";
		const form = createForm({
			initialData: { name: "" },
			validators: [() => [issue("sync")]],
			asyncValidators: [
				{ id: "owned", fields: ["name"], validate: async () => [issue(code)] },
				{ id: "other", fields: ["name"], validate: async () => [issue("other")] },
			],
		});
		form.setValue("name", "first");
		await form.validateAsync();
		code = "replacement";
		await form.validateAsync("name");

		const state = form.getState();
		expect(state.issues.some((entry) => entry.code === "sync")).toBe(true);
		expect(state.issues.filter((entry) => entry.source.validatorId === "owned")).toHaveLength(1);
		expect(state.issues.find((entry) => entry.code === "replacement")?.source).toMatchObject({
			origin: "async-validator",
			validatorId: "owned",
		});
	});

	it("preserves async and non-pipeline issues through a policy-only pipeline refresh", async () => {
		const asyncIssue = issue("async");
		const form = createForm({
			initialData: { tick: 0 },
			asyncValidators: [{ id: "owned", validate: async () => [asyncIssue] }],
			plugins: [{ id: "policy", evaluate: () => ({ fieldPolicy: [{ path: "tick", required: true }] }) }],
		});
		await form.validateAsync();
		const before = form.getState().issues;
		form.dispatch({ type: "policy-refresh" });
		expect(form.getState().issues).toEqual(before);
		expect(form.canSubmit()).toBe(false);
	});

	it("keeps literal $ui data paths distinct for blur validation", async () => {
		let calls = 0;
		const form = createForm({
			initialData: { $ui: { name: "" } },
			asyncValidators: [
				{
					id: "literal-ui",
					fields: [["$ui", "name"]],
					trigger: "onBlur",
					debounceMs: 0,
					validate: async () => {
						calls += 1;
						return [];
					},
				},
			],
		});
		form.fieldDynamic("/$ui/name").markTouched();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(calls).toBe(1);
		expect(form.getState().fieldMeta["/$ui/name"]?.touched).toBe(true);
	});
});

describe("validation concurrency and lifecycle", () => {
	it("projects debounce and foreground work globally and only onto watched fields", async () => {
		vi.useFakeTimers();
		try {
			const pending = deferred<readonly ValidationIssue[]>();
			const form = createForm({
				initialData: { name: "", other: "" },
				asyncValidators: [{ id: "name", fields: ["name"], debounceMs: 10, validate: () => pending.promise }],
			});
			form.setValue("name", "Ada");
			expect(form.getState().meta.validation.validating).toBe(true);
			expect(form.field("name").isValidating()).toBe(true);
			expect(form.field("other").isValidating()).toBe(false);
			expect(form.canSubmit()).toBe(false);
			await vi.advanceTimersByTimeAsync(10);
			pending.resolve([]);
			await vi.runAllTimersAsync();
			expect(form.getState().meta.validation.validating).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it("supersedes abort-ignoring foreground work without stale issues or finally status writes", async () => {
		const first = deferred<readonly ValidationIssue[]>();
		let call = 0;
		const form = createForm({
			initialData: { name: "" },
			asyncValidators: [
				{
					id: "name",
					fields: ["name"],
					validate: async () => (++call === 1 ? first.promise : [issue("new")]),
				},
			],
		});
		const stale = form.validateAsync("name");
		const current = form.validateAsync("name");
		expect(await stale).toEqual({ status: "superseded", issues: [] });
		expect((await current).issues.map((entry) => entry.code)).toEqual(["new"]);
		first.resolve([issue("stale")]);
		await Promise.resolve();
		expect(form.getState().issues.some((entry) => entry.code === "stale")).toBe(false);
		expect(form.getState().meta.validation.validating).toBe(false);
	});

	it("returns aborted for external abort, reset, and disposal even when validators ignore abort", async () => {
		for (const lifecycle of ["signal", "reset", "dispose"] as const) {
			const pending = deferred<readonly ValidationIssue[]>();
			const controller = new AbortController();
			const form = createForm({
				asyncValidators: [{ id: "slow", validate: () => pending.promise }],
			});
			const result = form.validateAsync(undefined, controller.signal);
			if (lifecycle === "signal") controller.abort();
			if (lifecycle === "reset") form.reset();
			if (lifecycle === "dispose") form.dispose();
			expect(await result).toEqual({ status: "aborted", issues: [] });
			pending.resolve([issue("late")]);
			await Promise.resolve();
			if (lifecycle !== "dispose") expect(form.getState().issues).toEqual([]);
			form.dispose();
		}
	});

	it("supersedes a snapshot when form data mutates", async () => {
		const pending = deferred<readonly ValidationIssue[]>();
		const form = createForm({
			initialData: { name: "before" },
			asyncValidators: [{ id: "slow", validate: () => pending.promise }],
		});
		const validation = form.validateAsync();
		form.setValue("name", "after");
		expect(await validation).toEqual({ status: "superseded", issues: [] });
		pending.resolve([issue("late")]);
		await Promise.resolve();
		expect(form.getState().issues.some((entry) => entry.code === "late")).toBe(false);
	});

	it("invalidates abort-ignoring automatic work after an unrelated mutation", async () => {
		const stale = deferred<readonly ValidationIssue[]>();
		const snapshots: unknown[] = [];
		const form = createForm({
			initialData: { a: 0, b: 0 },
			asyncValidators: [
				{
					id: "a",
					fields: ["a"],
					debounceMs: 0,
					validate: async ({ data }) => {
						snapshots.push(data);
						return snapshots.length === 1 ? stale.promise : [];
					},
				},
			],
		});
		form.setValue("a", 1);
		await new Promise((resolve) => setTimeout(resolve, 0));
		form.setValue("b", 2);
		stale.resolve([issue("STALE", "a")]);
		await new Promise((resolve) => setTimeout(resolve, 0));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(snapshots).toEqual([
			{ a: 1, b: 0 },
			{ a: 1, b: 2 },
		]);
		expect(form.getState().issues.some((entry) => entry.code === "STALE")).toBe(false);
	});

	it("settles validating flags before disposal and rejects late commits", async () => {
		const pending = deferred<readonly ValidationIssue[]>();
		const form = createForm({
			initialData: { name: "" },
			asyncValidators: [{ id: "pending", fields: ["name"], validate: () => pending.promise }],
		});
		const validation = form.validateAsync("name");
		expect(form.getState().meta.validation.validating).toBe(true);
		form.dispose();
		expect(await validation).toEqual({ status: "aborted", issues: [] });
		expect(form.getState().meta.validation.validating).toBe(false);
		expect(form.getState().fieldMeta.name?.isValidating).toBe(false);
		pending.resolve([issue("late")]);
		await Promise.resolve();
		expect(form.getState().issues).toEqual([]);
	});

	it("turns current validator exceptions into blocking owned issues", async () => {
		const form = createForm({
			asyncValidators: [{ id: "throws", validate: async () => Promise.reject(new Error("broken")) }],
		});
		const result = await form.validateAsync();
		expect(result.status).toBe("completed");
		expect(result.issues).toContainEqual(
			expect.objectContaining({
				code: "ASYNC_VALIDATOR_EXCEPTION",
				message: "broken",
				source: { origin: "async-validator", validatorId: "throws" },
			}),
		);
		expect(form.canSubmit()).toBe(false);
	});
});
