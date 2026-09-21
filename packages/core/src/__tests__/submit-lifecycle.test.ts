import { describe, expect, it, vi } from "vitest";
import { createForm } from "../create-form.js";
import type { ValidationIssue } from "../state.js";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

function issue(code: string): ValidationIssue {
	return {
		code,
		message: code,
		severity: "error",
		path: { namespace: "data", segments: ["name"] },
		source: { origin: "async-validator", validatorId: "async" },
	};
}

describe("snapshot-safe submit", () => {
	it("validates the post-pipeline snapshot and gives only its transformed payload to the handler", async () => {
		const validated: unknown[] = [];
		const submitted: unknown[] = [];
		const form = createForm({
			initialData: { name: "before" },
			plugins: [
				{
					id: "pipeline",
					evaluate: ({ action }) =>
						action.type === "submit" ? { writes: [{ path: "name", value: "pipeline", mode: "set" }] } : {},
				},
			],
			transforms: [
				{ id: "egress", phase: "egress", transform: (value) => ({ ...(value as object), transformed: true }) },
			],
			asyncValidators: [
				{
					id: "async",
					validate: async ({ data }) => {
						validated.push(data);
						return [];
					},
				},
			],
			onSubmit: async ({ payload, signal }) => {
				expect(signal).toBeInstanceOf(AbortSignal);
				submitted.push(payload);
				return { ok: true, submitId: "handler" };
			},
		});

		const result = await form.submit();
		expect(result.ok).toBe(true);
		expect(validated).toEqual([{ name: "pipeline" }]);
		expect(submitted).toEqual([{ name: "pipeline", transformed: true }]);
	});

	it("keeps submitting true through validation while validating is independently observable", async () => {
		const pending = deferred<readonly ValidationIssue[]>();
		const form = createForm({
			asyncValidators: [{ id: "async", validate: () => pending.promise }],
			onSubmit: vi.fn().mockResolvedValue({ ok: true, submitId: "done" }),
		});
		const submission = form.submit();
		expect(form.isSubmitting()).toBe(true);
		expect(form.getState().meta.validation.validating).toBe(true);
		expect(form.canSubmit()).toBe(false);
		pending.resolve([]);
		await submission;
		expect(form.isSubmitting()).toBe(false);
		expect(form.getState().meta.validation.validating).toBe(false);
	});

	it("returns validation-superseded and never calls the handler after mutation", async () => {
		const pending = deferred<readonly ValidationIssue[]>();
		const onSubmit = vi.fn().mockResolvedValue({ ok: true, submitId: "unexpected" });
		const form = createForm({
			initialData: { name: "before" },
			asyncValidators: [{ id: "async", validate: () => pending.promise }],
			onSubmit,
		});
		const submission = form.submit();
		form.setValue("name", "after");

		expect(await submission).toMatchObject({ ok: false, reason: "validation-superseded" });
		expect(onSubmit).not.toHaveBeenCalled();
		pending.resolve([]);
		form.dispose();
	});

	it("blocks the handler on async validation issues and exceptions", async () => {
		for (const validate of [async () => [issue("invalid")], async () => Promise.reject(new Error("broken"))]) {
			const onSubmit = vi.fn();
			const form = createForm({ asyncValidators: [{ id: "async", validate }], onSubmit });
			const result = await form.submit();
			expect(result).toMatchObject({ ok: false, reason: "validation-failed" });
			expect(onSubmit).not.toHaveBeenCalled();
			expect(form.getState().issues).toHaveLength(1);
			form.dispose();
		}
	});
});

describe("submit cancellation lifecycle", () => {
	it("caller abort resolves aborted and ignores an abort-insensitive handler completion", async () => {
		const handler = deferred<{ ok: true; submitId: string }>();
		const controller = new AbortController();
		const form = createForm({ onSubmit: () => handler.promise });
		const submission = form.submit(undefined, controller.signal);
		controller.abort();
		expect(await submission).toMatchObject({ ok: false, reason: "aborted" });
		handler.resolve({ ok: true, submitId: "late" });
		await Promise.resolve();
		expect(form.getState().meta.submission?.status).toBe("failed");
	});

	it("reset aborts a handler, restores idle, and permits a fresh submit", async () => {
		const first = deferred<{ ok: true; submitId: string }>();
		const onSubmit = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce({ ok: true, submitId: "fresh" });
		const form = createForm({ onSubmit });
		const stale = form.submit();
		await Promise.resolve();
		form.reset();
		expect(form.getState().meta.submission?.status).toBe("idle");
		expect(await stale).toMatchObject({ ok: false, reason: "aborted" });
		expect((await form.submit()).ok).toBe(true);
		first.resolve({ ok: true, submitId: "late" });
		await Promise.resolve();
		expect(form.getState().meta.submission?.status).toBe("succeeded");
	});

	it("dispose aborts validation and the handler race without late writes", async () => {
		const validation = deferred<readonly ValidationIssue[]>();
		const form = createForm({
			asyncValidators: [{ id: "async", validate: () => validation.promise }],
			onSubmit: vi.fn(),
		});
		const submission = form.submit();
		form.dispose();
		expect(await submission).toMatchObject({ ok: false, reason: "aborted" });
		validation.resolve([issue("late")]);
		await Promise.resolve();
		expect(form.getState().issues).toEqual([]);
	});
});
