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
