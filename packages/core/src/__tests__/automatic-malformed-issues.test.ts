import { afterEach, expect, it, vi } from "vitest";
import { createForm } from "../create-form.js";
import type { ValidationIssue } from "../state.js";
import { createValidationCoordinator } from "../validation-coordinator.js";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function issue(code: string): ValidationIssue {
	return {
		code,
		message: code,
		severity: "error",
		path: { namespace: "data", segments: ["x"] },
		source: { origin: "async-validator", validatorId: "v" },
	};
}

afterEach(() => vi.useRealTimers());

it("publishes a code-only blocking failure for malformed automatic results and recovers", async () => {
	vi.useFakeTimers();
	let malformed = true;
	const form = createForm({
		initialData: { x: 0 },
		asyncValidators: [
			{
				id: "v",
				fields: ["x"],
				debounceMs: 0,
				validate: async () => [malformed ? { ...issue("bad"), details: { bad: Symbol("x") } } : issue("ok")],
			},
		],
	});
	form.setValue("x", 1);
	await vi.runAllTimersAsync();
	expect(form.getState().meta.validation.validating).toBe(false);
	expect(form.getState().fieldMeta.x?.isValidating).toBe(false);
	expect(form.getState().issues).toEqual([
		{
			code: "ASYNC_VALIDATOR_EXCEPTION",
			message: "ISSUE_ONLY_UNSUPPORTED_STATE",
			severity: "error",
			path: { namespace: "data", segments: ["x"] },
			source: { origin: "async-validator", validatorId: "v" },
		},
	]);
	expect(form.canSubmit()).toBe(false);
	malformed = false;
	form.setValue("x", 2);
	await vi.runAllTimersAsync();
	expect(form.getState().issues.map((entry) => entry.code)).toEqual(["ok"]);
	form.dispose();
});

it.each(["supersede", "reset", "dispose"] as const)(
	"ignores malformed stale automatic results after %s",
	async (cause) => {
		vi.useFakeTimers();
		const pending = deferred<readonly ValidationIssue[]>();
		let calls = 0;
		const form = createForm({
			initialData: { x: 0 },
			asyncValidators: [
				{
					id: "v",
					fields: ["x"],
					debounceMs: 0,
					validate: () => (++calls === 1 ? pending.promise : Promise.resolve([issue("new")])),
				},
			],
		});
		form.setValue("x", 1);
		await vi.runAllTimersAsync();
		if (cause === "supersede") form.setValue("x", 2);
		if (cause === "reset") form.reset();
		if (cause === "dispose") form.dispose();
		pending.resolve([{ ...issue("bad"), details: { bad: Symbol("x") } }]);
		await vi.runAllTimersAsync();
		expect(form.getState().issues.map((entry) => entry.code)).toEqual(cause === "supersede" ? ["new"] : []);
		expect(form.getState().meta.validation.validating).toBe(false);
		form.dispose();
	},
);

it("does not clear a reentrant successor when failure publication starts a new run", async () => {
	vi.useFakeTimers();
	const form = createForm({
		initialData: { x: 0 },
		asyncValidators: [
			{
				id: "v",
				fields: ["x"],
				debounceMs: 0,
				validate: async ({ data }) =>
					data.x === 1 ? [{ ...issue("bad"), details: { bad: Symbol("x") } }] : [issue("new")],
			},
		],
	});
	let reentered = false;
	const unsubscribe = form.subscribe((state) => {
		if (reentered || !state.issues.some((entry) => entry.code === "ASYNC_VALIDATOR_EXCEPTION")) return;
		reentered = true;
		form.setValue("x", 2);
	});
	form.setValue("x", 1);
	await vi.runAllTimersAsync();
	await Promise.resolve();
	expect(reentered).toBe(true);
	expect(form.getState().issues.map((entry) => entry.code)).toEqual(["new"]);
	expect(form.getState().meta.validation.validating).toBe(false);
	unsubscribe();
	form.dispose();
});

it("contains a failure in the reporting channel without an unhandled rejection", async () => {
	vi.useFakeTimers();
	const form = createForm({ initialData: { x: 0 } });
	const log = vi.spyOn(console, "error").mockImplementation(() => {});
	let state = form.getState();
	const coordinator = createValidationCoordinator({
		validators: [
			{
				id: "v",
				fields: ["x"],
				debounceMs: 0,
				validate: async () => [
					{
						...issue("bad"),
						details: { bad: Symbol("x") },
					},
				],
			},
		],
		getState: () => state,
		updateState: (update) => {
			const next = update(state);
			if (next.issues.length) throw new Error("report failed");
			state = next;
		},
	});
	try {
		coordinator.onMutation({ namespace: "data", segments: ["x"] }, "onChange");
		await vi.runAllTimersAsync();
		expect(log).toHaveBeenCalledWith("ASYNC_VALIDATOR_FAILURE_REPORT_FAILED");
	} finally {
		coordinator.dispose();
		log.mockRestore();
		form.dispose();
	}
});
