import { describe, expect, it, vi } from "vitest";
import { createForm } from "../create-form.js";
import type { FormPlugin } from "../plugin-types.js";
import type { ValidationIssue } from "../state.js";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((complete, fail) => {
		resolve = complete;
		reject = fail;
	});
	return { promise, resolve, reject };
}

function runtimePluginGate(id: string, gate: () => unknown): FormPlugin {
	const plugin: FormPlugin = { id };
	Object.defineProperty(plugin, "beforeSubmit", { value: gate });
	return plugin;
}

function flushUnhandledRejections(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
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
	it("uses the generated attempt ID across state, handler result, return, and middleware", async () => {
		const afterSubmit: string[] = [];
		const form = createForm({
			idGenerator: () => "generated",
			onSubmit: async ({ submitContext }) => {
				expect(submitContext.requestId).toBe("generated");
				return { ok: true, submitId: "handler" };
			},
			middleware: [{ id: "observe", afterSubmit: ({ result }) => afterSubmit.push(result.submitId) }],
		});
		const result = await form.submit();
		expect(result.submitId).toBe("generated");
		expect(form.getState().meta.submission?.submitId).toBe("generated");
		expect(afterSubmit).toEqual(["generated"]);
	});

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
	it("contains synchronous plugin gate throws without leaking the running lock", async () => {
		let shouldFail = true;
		const form = createForm({
			plugins: [
				{
					id: "gate",
					beforeSubmit: () => {
						if (shouldFail) throw new Error("thrown gate");
						return [];
					},
				},
			],
		});
		const failed = await form.submit();
		expect(failed).toMatchObject({ ok: false, message: "thrown gate" });
		expect(form.getState().meta.submission?.status).toBe("failed");
		shouldFail = false;
		expect((await form.submit()).ok).toBe(true);
		form.dispose();
	});

	it("fails closed on an immediate rejected thenable before a later synchronous throw", async () => {
		const unhandled: unknown[] = [];
		const capture = (reason: unknown) => unhandled.push(reason);
		let valid = false;
		const laterGate = vi.fn(() => {
			if (!valid) throw new Error("later throw");
			return [];
		});
		const form = createForm({
			plugins: [
				runtimePluginGate("thenable", () => (valid ? [] : Promise.reject(new Error("rejected thenable")))),
				{ id: "later", beforeSubmit: laterGate },
			],
		});
		process.on("unhandledRejection", capture);
		try {
			const failed = await form.submit();
			expect(failed).toMatchObject({
				ok: false,
				message: 'Plugin "thenable" beforeSubmit must return issues synchronously',
			});
			expect(laterGate).not.toHaveBeenCalled();
			expect(form.getState().meta.submission?.status).toBe("failed");
			await flushUnhandledRejections();
			expect(unhandled).toEqual([]);
			valid = true;
			expect((await form.submit()).ok).toBe(true);
		} finally {
			process.off("unhandledRejection", capture);
			form.dispose();
		}
	});

	it("ignores a deferred thenable resolution across reset and permits a later submit", async () => {
		const gate = deferred<readonly ValidationIssue[]>();
		let valid = false;
		const form = createForm({
			plugins: [runtimePluginGate("deferred", () => (valid ? [] : gate.promise))],
		});
		const submission = form.submit();
		expect(form.getState().meta.submission?.status).toBe("failed");
		form.reset();
		const failed = await submission;
		expect(failed).toMatchObject({ ok: false, message: expect.stringContaining("must return issues synchronously") });
		gate.resolve([issue("LATE_GATE")]);
		await Promise.resolve();
		expect(form.getState().issues).toEqual([]);
		expect(form.getState().meta.submission?.status).toBe("idle");
		valid = true;
		expect((await form.submit()).ok).toBe(true);
		form.dispose();
	});

	it("ignores a deferred thenable rejection across dispose without an unhandled rejection", async () => {
		const gate = deferred<readonly ValidationIssue[]>();
		const unhandled: unknown[] = [];
		const capture = (reason: unknown) => unhandled.push(reason);
		const form = createForm({ plugins: [runtimePluginGate("deferred", () => gate.promise)] });
		process.on("unhandledRejection", capture);
		try {
			const submission = form.submit();
			expect(form.getState().meta.submission?.status).toBe("failed");
			form.dispose();
			const failed = await submission;
			expect(failed.ok).toBe(false);
			gate.reject(new Error("late rejection"));
			await flushUnhandledRejections();
			expect(unhandled).toEqual([]);
			expect(form.getState().issues).toEqual([]);
		} finally {
			process.off("unhandledRejection", capture);
		}
	});

	it("removes caller and internal abort listeners after repeated normal submissions", async () => {
		const controller = new AbortController();
		const add = vi.spyOn(controller.signal, "addEventListener");
		const remove = vi.spyOn(controller.signal, "removeEventListener");
		const form = createForm({ onSubmit: async () => ({ ok: true, submitId: "handler" }) });
		for (let attempt = 0; attempt < 3; attempt++)
			expect((await form.submit(undefined, controller.signal)).ok).toBe(true);
		const callerAdds = add.mock.calls.filter(([type]) => type === "abort").length;
		const callerRemoves = remove.mock.calls.filter(([type]) => type === "abort").length;
		expect(callerAdds).toBe(3);
		expect(callerRemoves).toBe(3);
	});

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
