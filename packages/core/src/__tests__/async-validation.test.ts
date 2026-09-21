import { describe, expect, it } from "vitest";
import type { AsyncValidatorConfig } from "../contracts.js";
import { createForm } from "../create-form.js";
import type { ValidationIssue } from "../state.js";

function makeAsyncValidator(opts: {
	label: string;
	fields?: readonly string[];
	debounceMs?: number;
	trigger?: "onChange" | "onBlur";
	issues?: readonly ValidationIssue[];
	delayMs?: number;
	onCall?: () => void;
	waitUntil?: Promise<void>;
}): AsyncValidatorConfig {
	const issues = opts.issues ?? [
		{
			code: "async-error",
			message: "Async validation failed",
			severity: "error" as const,
			path: {
				namespace: "data" as const,
				segments: (opts.fields?.[0] ?? "field").split("."),
				canonical: opts.fields?.[0] ?? "field",
			},
			source: { origin: "async-validator" as const, validatorId: opts.label },
		},
	];

	return {
		id: opts.label,
		label: opts.label,
		fields: opts.fields,
		debounceMs: opts.debounceMs,
		trigger: opts.trigger,
		validate: async ({ signal }) => {
			opts.onCall?.();
			if (opts.waitUntil) await opts.waitUntil;
			if (opts.delayMs) {
				await new Promise<void>((resolve) => {
					const timer = setTimeout(resolve, opts.delayMs);
					signal.addEventListener("abort", () => {
						clearTimeout(timer);
						resolve();
					});
				});
			}
			if (signal.aborted) return [];
			return issues;
		},
	};
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDeferred() {
	let resolve = () => undefined;
	const promise = new Promise<void>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

async function waitFor(condition: () => boolean, description: string, timeoutMs = 1_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!condition()) {
		if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}`);
		await wait(1);
	}
}

describe("async validation", () => {
	it("debounce fires after delay and sets isValidating", async () => {
		const form = createForm({
			initialData: { name: "" },
			asyncValidators: [makeAsyncValidator({ label: "av1", fields: ["name"], debounceMs: 20 })],
		});
		const field = form.field("name");

		form.setValue("name", "test");
		// isValidating should be true immediately after setValue triggers async
		expect(field.isValidating()).toBe(true);

		// Wait for debounce + validation
		await wait(50);
		expect(field.isValidating()).toBe(false);

		// Issues should be merged into state
		const issues = form.getState().issues.filter((i) => i.source.origin === "async-validator");
		expect(issues.length).toBeGreaterThan(0);
		form.dispose();
	});

	it("cancellation on rapid value changes — only final validation runs", async () => {
		let callCount = 0;
		const form = createForm({
			initialData: { name: "" },
			asyncValidators: [
				makeAsyncValidator({
					label: "av1",
					fields: ["name"],
					debounceMs: 20,
					onCall: () => {
						callCount++;
					},
				}),
			],
		});

		form.setValue("name", "a");
		form.setValue("name", "ab");
		form.setValue("name", "abc");

		await wait(60);
		// Only the last debounced call should have fired
		expect(callCount).toBe(1);
		form.dispose();
	});

	it("AbortSignal respected — discarded on cancel", async () => {
		let callCount = 0;
		const form = createForm({
			initialData: { name: "" },
			asyncValidators: [
				makeAsyncValidator({
					label: "av1",
					fields: ["name"],
					debounceMs: 10,
					delayMs: 50,
					onCall: () => {
						callCount++;
					},
				}),
			],
		});

		form.setValue("name", "test");
		await wait(20); // debounce fires, validation starts
		expect(callCount).toBe(1);

		// Cancel by setting again before validation completes
		form.setValue("name", "test2");
		await wait(80); // wait for second validation to complete

		// Second call should have happened
		expect(callCount).toBe(2);
		form.dispose();
	});

	it("isValidating transitions: false → true → false", async () => {
		const form = createForm({
			initialData: { name: "" },
			asyncValidators: [makeAsyncValidator({ label: "av1", fields: ["name"], debounceMs: 10, delayMs: 20 })],
		});
		const field = form.field("name");

		expect(field.isValidating()).toBe(false);
		form.setValue("name", "x");
		expect(field.isValidating()).toBe(true);
		await wait(50);
		expect(field.isValidating()).toBe(false);
		form.dispose();
	});

	it("multiple fields concurrent — both can be validating simultaneously", async () => {
		const releaseValidation = createDeferred();
		let startedCount = 0;
		const markStarted = () => {
			startedCount += 1;
		};
		const form = createForm({
			initialData: { name: "", email: "" },
			asyncValidators: [
				makeAsyncValidator({
					label: "av-name",
					fields: ["name"],
					debounceMs: 10,
					onCall: markStarted,
					waitUntil: releaseValidation.promise,
				}),
				makeAsyncValidator({
					label: "av-email",
					fields: ["email"],
					debounceMs: 10,
					onCall: markStarted,
					waitUntil: releaseValidation.promise,
				}),
			],
		});

		const nameField = form.field("name");
		const emailField = form.field("email");

		form.setValue("name", "x");
		form.setValue("email", "y");

		try {
			await waitFor(() => startedCount === 2, "both validators to start");
			expect(nameField.isValidating()).toBe(true);
			expect(emailField.isValidating()).toBe(true);

			releaseValidation.resolve();
			await waitFor(() => !nameField.isValidating() && !emailField.isValidating(), "both validators to settle");

			const asyncIssues = form.getState().issues.filter((i) => i.source.origin === "async-validator");
			expect(asyncIssues.length).toBe(2);
		} finally {
			releaseValidation.resolve();
			form.dispose();
		}
	});

	it("issue merge: replaces previous async issues from same validator", async () => {
		let issueCode = "first";
		const form = createForm({
			initialData: { name: "" },
			asyncValidators: [
				{
					id: "av1",
					label: "av1",
					fields: ["name"],
					debounceMs: 10,
					validate: async ({ signal }) => {
						if (signal.aborted) return [];
						return [
							{
								code: issueCode,
								message: issueCode,
								severity: "error" as const,
								path: { namespace: "data" as const, segments: ["name"], canonical: "name" },
								source: { origin: "async-validator" as const, validatorId: "av1" },
							},
						];
					},
				},
			],
		});

		form.setValue("name", "a");
		await wait(30);
		expect(form.getState().issues.some((i) => i.code === "first")).toBe(true);

		issueCode = "second";
		form.setValue("name", "b");
		await wait(30);

		const asyncIssues = form.getState().issues.filter((i) => i.source.origin === "async-validator");
		expect(asyncIssues.length).toBe(1);
		expect(asyncIssues[0].code).toBe("second");
		form.dispose();
	});

	it("sync issues untouched when async issues merge", async () => {
		const syncValidator = () => [
			{
				code: "sync-error",
				message: "Sync error",
				severity: "error" as const,
				path: { namespace: "data" as const, segments: ["name"], canonical: "name" },
				source: { origin: "function-validator" as const, validatorId: "sync-v" },
			},
		];

		const form = createForm({
			initialData: { name: "" },
			validators: [syncValidator],
			asyncValidators: [makeAsyncValidator({ label: "av1", fields: ["name"], debounceMs: 10 })],
		});

		form.setValue("name", "x");
		await wait(30);

		const syncIssues = form.getState().issues.filter((i) => i.source.origin === "function-validator");
		const asyncIssues = form.getState().issues.filter((i) => i.source.origin === "async-validator");
		expect(syncIssues.length).toBeGreaterThan(0);
		expect(asyncIssues.length).toBeGreaterThan(0);
		form.dispose();
	});

	it("reset cancels all and clears isValidating", async () => {
		const form = createForm({
			initialData: { name: "" },
			asyncValidators: [makeAsyncValidator({ label: "av1", fields: ["name"], debounceMs: 10, delayMs: 50 })],
		});
		const field = form.field("name");

		form.setValue("name", "x");
		expect(field.isValidating()).toBe(true);

		form.reset();
		// After reset, fieldMeta is cleared
		const newField = form.field("name");
		expect(newField.isValidating()).toBe(false);
		expect(form.getState().issues).toEqual([]);

		await wait(80); // ensure no stale callbacks fire
		expect(form.getState().issues).toEqual([]);
		form.dispose();
	});

	it("onBlur trigger: fires on markTouched, not on setValue", async () => {
		let callCount = 0;
		const form = createForm({
			initialData: { name: "" },
			asyncValidators: [
				makeAsyncValidator({
					label: "av1",
					fields: ["name"],
					debounceMs: 10,
					trigger: "onBlur",
					onCall: () => {
						callCount++;
					},
				}),
			],
		});

		form.setValue("name", "x");
		await wait(30);
		expect(callCount).toBe(0); // onChange should not trigger onBlur validator

		form.field("name").markTouched();
		await wait(30);
		expect(callCount).toBe(1);
		form.dispose();
	});

	it("submit runs all async validators", async () => {
		let asyncCalled = false;
		const form = createForm({
			initialData: { name: "" },
			asyncValidators: [
				{
					id: "av1",
					label: "av1",
					fields: ["name"],
					debounceMs: 300,
					validate: async ({ signal }) => {
						asyncCalled = true;
						if (signal.aborted) return [];
						return [
							{
								code: "async-submit",
								message: "Async submit error",
								severity: "error" as const,
								path: { namespace: "data" as const, segments: ["name"], canonical: "name" },
								source: { origin: "async-validator" as const, validatorId: "av1" },
							},
						];
					},
				},
			],
		});

		const result = await form.submit();
		expect(asyncCalled).toBe(true);
		// Submit should fail because async validator returned error issues
		expect(result.ok).toBe(false);
		form.dispose();
	});

	it("cancel-during-in-flight: isValidating stays true until second validation completes", async () => {
		const form = createForm({
			initialData: { name: "" },
			asyncValidators: [
				makeAsyncValidator({
					label: "av1",
					fields: ["name"],
					debounceMs: 5,
					delayMs: 40,
				}),
			],
		});
		const field = form.field("name");

		// First setValue → schedules validation
		form.setValue("name", "a");
		expect(field.isValidating()).toBe(true);

		// Wait for debounce to fire (validation starts, await pending)
		await wait(15);
		expect(field.isValidating()).toBe(true);

		// Second setValue while first validation is in-flight → cancels old, schedules new
		form.setValue("name", "ab");
		// isValidating must stay true — no gap
		expect(field.isValidating()).toBe(true);

		// Wait for old finally to run (microtask after abort) — must NOT drop to false
		await wait(5);
		expect(field.isValidating()).toBe(true);

		// Wait for second validation to complete
		await wait(80);
		expect(field.isValidating()).toBe(false);
		form.dispose();
	});
});
