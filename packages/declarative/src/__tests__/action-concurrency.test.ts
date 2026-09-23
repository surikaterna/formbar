import { createForm } from "@formbar/core";
import { describe, expect, it, vi } from "vitest";
import type { FormNode } from "../index.js";
import { createActionExecutor, createFormRuntime } from "../index.js";
import { binding } from "./fixtures.js";
import { definition } from "./runtime-fixtures.js";

const key = (id: string) => JSON.stringify([id, []]);

function deferred() {
	let resolve!: () => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<void>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

function setup(node: FormNode) {
	const form = createForm({ initialData: { name: "first" }, initialUiState: {} });
	const runtime = createFormRuntime({ form, definition: definition([node]) });
	return { form, runtime };
}

describe("action executor concurrency", () => {
	it("drops overlapping work without disturbing the pending run", async () => {
		const active = deferred();
		const { form, runtime } = setup({ type: "action", id: "run", action: "host.run" });
		const executor = createActionExecutor({
			form,
			runtime,
			actions: [{ id: "host.run", handler: () => active.promise }],
		});
		const first = executor.execute(key("run"));
		await Promise.resolve();
		expect(await executor.execute(key("run"))).toEqual({ status: "dropped" });
		expect(executor.observe(key("run")).getSnapshot().status).toBe("pending");
		active.resolve();
		expect(await first).toEqual({ status: "completed" });
		executor.dispose();
		runtime.dispose();
		form.dispose();
	});

	it("replace aborts an ignored signal and contains the stale completion", async () => {
		const runs = [deferred(), deferred()];
		const signals: AbortSignal[] = [];
		const handler = vi.fn((_request, context) => {
			signals.push(context.signal);
			return runs[signals.length - 1]?.promise;
		});
		const { form, runtime } = setup({ type: "action", id: "run", action: "host.run", concurrency: "replace" });
		const executor = createActionExecutor({ form, runtime, actions: [{ id: "host.run", handler }] });
		const first = executor.execute(key("run"));
		await Promise.resolve();
		const second = executor.execute(key("run"));
		expect(await first).toEqual({ status: "aborted", diagnostic: "action-aborted" });
		expect(signals[0]?.aborted).toBe(true);
		await Promise.resolve();
		runs[1]?.resolve();
		expect(await second).toEqual({ status: "completed" });
		runs[0]?.reject(new Error("private late failure"));
		await Promise.resolve();
		expect(executor.observe(key("run")).getSnapshot()).toEqual({ status: "succeeded" });
		executor.dispose();
		runtime.dispose();
		form.dispose();
	});

	it("queues FIFO and re-evaluates payload and snapshot when each run starts", async () => {
		const first = deferred();
		const requests: unknown[] = [];
		const snapshots: unknown[] = [];
		const handler = vi.fn((request, context) => {
			requests.push(request.payload);
			snapshots.push(context.snapshot.data);
			return requests.length === 1 ? first.promise : undefined;
		});
		const { form, runtime } = setup({
			type: "action",
			id: "run",
			action: "host.run",
			concurrency: "queue",
			payload: { kind: "ref", ref: binding(["name"]) },
		});
		const executor = createActionExecutor({ form, runtime, actions: [{ id: "host.run", handler }] });
		const active = executor.execute(key("run"));
		await Promise.resolve();
		const queued = executor.execute(key("run"));
		form.setValue("name", "second");
		expect(handler).toHaveBeenCalledOnce();
		first.resolve();
		expect(await active).toEqual({ status: "completed" });
		expect(await queued).toEqual({ status: "completed" });
		expect(requests).toEqual(["first", "second"]);
		expect(snapshots).toEqual([{ name: "first" }, { name: "second" }]);
		executor.dispose();
		runtime.dispose();
		form.dispose();
	});

	it("settles every queued intent when current-at-run state becomes unavailable", async () => {
		const first = deferred();
		const form = createForm({ initialData: { blocked: false }, initialUiState: {} });
		const runtime = createFormRuntime({
			form,
			definition: definition([
				{
					type: "action",
					id: "run",
					action: "host.run",
					concurrency: "queue",
					disabled: { kind: "ref", ref: binding(["blocked"]) },
				},
			]),
		});
		const executor = createActionExecutor({
			form,
			runtime,
			actions: [{ id: "host.run", handler: () => first.promise }],
		});
		const active = executor.execute(key("run"));
		await Promise.resolve();
		const queued = [executor.execute(key("run")), executor.execute(key("run"))];
		form.setValue("blocked", true);
		first.resolve();
		expect(await active).toEqual({ status: "completed" });
		expect(await Promise.all(queued)).toEqual([
			{ status: "failed", diagnostic: "action-unavailable" },
			{ status: "failed", diagnostic: "action-unavailable" },
		]);
		executor.dispose();
		runtime.dispose();
		form.dispose();
	});

	it("reactively locks pending actions on a repeated submit with one core subscription", async () => {
		const active = deferred();
		const submission = deferred();
		const handler = vi.fn(() => active.promise);
		let submissions = 0;
		const form = createForm({
			initialData: {},
			initialUiState: {},
			onSubmit: async () => {
				if (++submissions === 1) return { ok: true, submitId: "first" };
				await submission.promise;
				return { ok: true, submitId: "second" };
			},
		});
		const subscribe = vi.spyOn(form, "subscribe");
		const runtime = createFormRuntime({
			form,
			definition: definition([
				{ type: "action", id: "run", action: "host.run", concurrency: "queue" },
				{ type: "action", id: "other", action: "host.run" },
			]),
		});
		const executor = createActionExecutor({ form, runtime, actions: [{ id: "host.run", handler }] });
		const observation = executor.observe(key("run"));
		const listener = vi.fn();
		observation.getSnapshot();
		const stop = observation.subscribe(listener);
		await form.submit();
		const first = executor.execute(key("run"));
		await Promise.resolve();
		const queued = executor.execute(key("run"));
		listener.mockClear();
		const submit = form.submit();
		await Promise.resolve();

		expect(subscribe).toHaveBeenCalledOnce();
		expect(listener).toHaveBeenCalled();
		expect(observation.getSnapshot()).toEqual({ status: "pending", availability: "action-unavailable" });
		expect(await executor.execute(key("run"))).toEqual({ status: "failed", diagnostic: "action-unavailable" });
		expect(executor.observe(key("other")).getSnapshot().availability).toBe("action-unavailable");
		expect(await executor.execute(key("other"))).toEqual({ status: "failed", diagnostic: "action-unavailable" });
		submission.resolve();
		await submit;
		expect(observation.getSnapshot()).toEqual({ status: "pending" });
		active.resolve();
		expect(await first).toEqual({ status: "completed" });
		expect(await queued).toEqual({ status: "completed" });
		expect(handler).toHaveBeenCalledTimes(2);

		stop();
		observation.dispose();
		executor.dispose();
		runtime.dispose();
		form.dispose();
	});

	it.each(["drop", "replace"] as const)(
		"composes submission availability into a pending %s snapshot",
		async (concurrency) => {
			const active = deferred();
			const submission = deferred();
			let submissions = 0;
			const form = createForm({
				initialData: {},
				initialUiState: {},
				onSubmit: async () => {
					if (++submissions === 1) return { ok: true, submitId: "first" };
					await submission.promise;
					return { ok: true, submitId: "second" };
				},
			});
			const runtime = createFormRuntime({
				form,
				definition: definition([{ type: "action", id: "run", action: "host.run", concurrency }]),
			});
			const executor = createActionExecutor({
				form,
				runtime,
				actions: [{ id: "host.run", handler: () => active.promise }],
			});
			const observation = executor.observe(key("run"));
			await form.submit();
			const execution = executor.execute(key("run"));
			await Promise.resolve();
			const secondSubmit = form.submit();
			await Promise.resolve();

			expect(observation.getSnapshot()).toEqual({ status: "pending", availability: "action-unavailable" });
			submission.resolve();
			await secondSubmit;
			expect(observation.getSnapshot()).toEqual({ status: "pending" });
			active.resolve();
			expect(await execution).toEqual({ status: "completed" });

			observation.dispose();
			executor.dispose();
			runtime.dispose();
			form.dispose();
		},
	);

	it("reset aborts active and queued work before restoring core state", async () => {
		const ignored = deferred();
		const form = createForm({ initialData: { name: "first" }, initialUiState: {} });
		const runtime = createFormRuntime({
			form,
			definition: definition([
				{ type: "action", id: "run", action: "host.run", concurrency: "queue" },
				{ type: "action", id: "reset", action: "reset" },
			]),
		});
		const executor = createActionExecutor({
			form,
			runtime,
			actions: [{ id: "host.run", handler: () => ignored.promise }],
		});
		form.setValue("name", "edited");
		const active = executor.execute(key("run"));
		await Promise.resolve();
		const queued = executor.execute(key("run"));
		expect(await executor.execute(key("reset"))).toEqual({ status: "completed" });
		expect(await active).toEqual({ status: "aborted", diagnostic: "action-aborted" });
		expect(await queued).toEqual({ status: "aborted", diagnostic: "action-aborted" });
		expect(form.getState().data).toEqual({ name: "first" });
		ignored.resolve();
		executor.dispose();
		runtime.dispose();
		form.dispose();
	});

	it("keeps reset available to abort submission and repeat the reset lifecycle", async () => {
		let started!: (signal: AbortSignal) => void;
		const submissionStarted = new Promise<AbortSignal>((resolve) => {
			started = resolve;
		});
		const ignored = deferred();
		const form = createForm({
			initialData: { name: "first" },
			initialUiState: {},
			onSubmit: async ({ signal }) => {
				started(signal);
				await ignored.promise;
				return { ok: true, submitId: "late" };
			},
		});
		const runtime = createFormRuntime({
			form,
			definition: definition([
				{ type: "action", id: "submit", action: "submit" },
				{ type: "action", id: "reset", action: "reset" },
			]),
		});
		const executor = createActionExecutor({ form, runtime });
		const resets = vi.fn();
		form.onReset(resets);
		form.setValue("name", "edited");
		const submission = executor.execute(key("submit"));
		const signal = await submissionStarted;

		expect(form.isSubmitting()).toBe(true);
		expect(executor.observe(key("reset")).getSnapshot().availability).toBeUndefined();
		expect(await executor.execute(key("reset"))).toEqual({ status: "completed" });
		expect(signal.aborted).toBe(true);
		expect(await submission).toEqual({ status: "aborted", diagnostic: "action-aborted" });
		expect(form.getState().data).toEqual({ name: "first" });
		expect(form.getState().meta.submitted).toBeUndefined();
		expect(form.isSubmitting()).toBe(false);
		expect(resets).toHaveBeenCalledOnce();
		expect(await executor.execute(key("reset"))).toEqual({ status: "completed" });
		expect(resets).toHaveBeenCalledTimes(2);

		ignored.resolve();
		executor.dispose();
		runtime.dispose();
		form.dispose();
	});

	it("direct core reset aborts active custom work", async () => {
		const ignored = deferred();
		const { form, runtime } = setup({ type: "action", id: "run", action: "host.run" });
		const executor = createActionExecutor({
			form,
			runtime,
			actions: [{ id: "host.run", handler: () => ignored.promise }],
		});
		form.setValue("name", "edited");
		const active = executor.execute(key("run"));
		await Promise.resolve();
		form.reset();
		expect(await active).toEqual({ status: "aborted", diagnostic: "action-aborted" });
		expect(form.getState().data).toEqual({ name: "first" });
		ignored.resolve();
		executor.dispose();
		runtime.dispose();
		form.dispose();
	});

	it.each(["executor", "runtime", "form"] as const)("aborts ignored work on %s disposal", async (owner) => {
		const ignored = deferred();
		const { form, runtime } = setup({ type: "action", id: "run", action: "host.run" });
		const executor = createActionExecutor({
			form,
			runtime,
			actions: [{ id: "host.run", handler: () => ignored.promise }],
		});
		const result = executor.execute(key("run"));
		await Promise.resolve();
		if (owner === "executor") executor.dispose();
		if (owner === "runtime") runtime.dispose();
		if (owner === "form") form.dispose();
		expect(await result).toEqual({ status: "aborted", diagnostic: "action-aborted" });
		ignored.resolve();
		executor.dispose();
		runtime.dispose();
		form.dispose();
	});
});
