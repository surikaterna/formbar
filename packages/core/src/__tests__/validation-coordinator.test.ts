import { describe, expect, it, vi } from "vitest";
import type { AsyncValidatorConfig } from "../contracts.js";
import { createForm } from "../create-form.js";
import type { ValidationIssue } from "../state.js";

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
