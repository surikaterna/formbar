import { createForm } from "@formbar/core";
import { describe, expect, it, vi } from "vitest";
import { createActionExecutor, createFormRuntime } from "../index.js";
import { definition } from "./runtime-fixtures.js";

const key = (id: string) => JSON.stringify([id, []]);
const aborted = { status: "aborted", diagnostic: "action-aborted" };

function deferred() {
	let resolve!: () => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<void>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

function setup(handler: (request: { instanceKey: string }, context: { signal: AbortSignal }) => Promise<void> | void) {
	const form = createForm({ initialData: {}, initialUiState: {} });
	const runtime = createFormRuntime({
		form,
		definition: definition([
			{ type: "action", id: "one", action: "host.run", concurrency: "queue" },
			{ type: "action", id: "two", action: "host.run", concurrency: "queue" },
			{ type: "action", id: "reset", action: "reset" },
		]),
	});
	const executor = createActionExecutor({ form, runtime, actions: [{ id: "host.run", handler }] });
	return { form, runtime, executor };
}

describe("bounded action queues", () => {
	it("accepts 32 FIFO waiters, drops 33..1024 promptly, and reclaims capacity on dequeue", async () => {
		const gates = [deferred(), deferred()];
		const order: number[] = [];
		const handler = vi.fn(() => {
			order.push(handler.mock.calls.length);
			return gates[order.length - 1]?.promise;
		});
		const { form, runtime, executor } = setup(handler);
		const active = executor.execute(key("one"));
		await Promise.resolve();
		const accepted = Array.from({ length: 32 }, () => executor.execute(key("one")));
		const overflow = Array.from({ length: 992 }, () => executor.execute(key("one")));
		expect(await Promise.all(overflow)).toEqual(Array.from({ length: 992 }, () => ({ status: "dropped" })));
		expect(handler).toHaveBeenCalledOnce();
		expect(executor.observe(key("one")).getSnapshot()).toEqual({ status: "pending" });
		gates[0]?.resolve();
		expect(await active).toEqual({ status: "completed" });
		await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
		const reclaimed = executor.execute(key("one"));
		expect(await executor.execute(key("one"))).toEqual({ status: "dropped" });
		gates[1]?.resolve();
		expect(await Promise.all([...accepted, reclaimed])).toEqual(
			Array.from({ length: 33 }, () => ({ status: "completed" })),
		);
		expect(order).toEqual(Array.from({ length: 34 }, (_, index) => index + 1));
		executor.dispose();
		runtime.dispose();
		form.dispose();
	});

	it("budgets concrete keys and executors independently", async () => {
		const gate = deferred();
		const a = setup(() => gate.promise);
		const b = setup(() => gate.promise);
		const active = [a.executor.execute(key("one")), a.executor.execute(key("two")), b.executor.execute(key("one"))];
		await Promise.resolve();
		const lanes = [
			[a.executor, key("one")],
			[a.executor, key("two")],
			[b.executor, key("one")],
		] as const;
		const waiting = lanes.flatMap(([executor, instance]) =>
			Array.from({ length: 32 }, () => executor.execute(instance)),
		);
		for (const [executor, instance] of lanes) {
			expect(await executor.execute(instance)).toEqual({ status: "dropped" });
		}
		gate.resolve();
		expect(await Promise.all([...active, ...waiting])).toEqual(
			Array.from({ length: 99 }, () => ({ status: "completed" })),
		);
		for (const item of [a, b]) {
			item.executor.dispose();
			item.runtime.dispose();
			item.form.dispose();
		}
	});

	it("preflight failure takes precedence at capacity without evicting waiters", async () => {
		const gate = deferred();
		const handler = vi.fn(() => gate.promise);
		const { form, runtime, executor } = setup(handler);
		const active = executor.execute(key("one"));
		await Promise.resolve();
		const waiting = Array.from({ length: 32 }, () => executor.execute(key("one")));
		const submitting = vi.spyOn(form, "isSubmitting").mockReturnValue(true);
		expect(await executor.execute(key("one"))).toEqual({ status: "failed", diagnostic: "action-unavailable" });
		submitting.mockRestore();
		expect(await executor.execute(key("one"))).toEqual({ status: "dropped" });
		gate.resolve();
		expect(await Promise.all([active, ...waiting])).toEqual(
			Array.from({ length: 33 }, () => ({ status: "completed" })),
		);
		expect(handler).toHaveBeenCalledTimes(33);
		executor.dispose();
		runtime.dispose();
		form.dispose();
	});

	it("checks capacity after synchronous preflight reentry", async () => {
		const gate = deferred();
		const handler = vi.fn(() => gate.promise);
		const { form, runtime, executor } = setup(handler);
		const active = executor.execute(key("one"));
		await Promise.resolve();
		const waiting = Array.from({ length: 31 }, () => executor.execute(key("one")));
		const original = form.isSubmitting;
		let nested: Promise<unknown> | undefined;
		let reenter = true;
		const spy = vi.spyOn(form, "isSubmitting").mockImplementation(() => {
			if (reenter) {
				reenter = false;
				nested = executor.execute(key("one"));
			}
			return original();
		});
		expect(await executor.execute(key("one"))).toEqual({ status: "dropped" });
		spy.mockRestore();
		expect(await executor.execute(key("one"))).toEqual({ status: "dropped" });
		gate.resolve();
		expect(await Promise.all([active, ...waiting, nested])).toEqual(
			Array.from({ length: 33 }, () => ({ status: "completed" })),
		);
		expect(handler).toHaveBeenCalledTimes(33);
		executor.dispose();
		runtime.dispose();
		form.dispose();
	});

	it.each(["direct reset", "built-in reset", "executor", "runtime", "form"] as const)(
		"aborts all accepted waiters on %s and contains late rejection",
		async (cause) => {
			const gate = deferred();
			const handler = vi.fn(() => gate.promise);
			const { form, runtime, executor } = setup(handler);
			const active = executor.execute(key("one"));
			await Promise.resolve();
			const waiting = Array.from({ length: 32 }, () => executor.execute(key("one")));
			expect(await executor.execute(key("one"))).toEqual({ status: "dropped" });
			if (cause === "direct reset") form.reset();
			if (cause === "built-in reset") expect(await executor.execute(key("reset"))).toEqual({ status: "completed" });
			if (cause === "executor") executor.dispose();
			if (cause === "runtime") runtime.dispose();
			if (cause === "form") form.dispose();
			expect(await Promise.all([active, ...waiting])).toEqual(Array.from({ length: 33 }, () => aborted));
			gate.reject(new Error("late private failure"));
			await Promise.resolve();
			expect(handler).toHaveBeenCalledOnce();
			executor.dispose();
			runtime.dispose();
			form.dispose();
		},
	);

	it("does not revive a detached lane through synchronous abort notifications", async () => {
		const gate = deferred();
		let reentrant: Promise<unknown> | undefined;
		const { form, runtime, executor } = setup((_request, { signal }) => {
			signal.addEventListener("abort", () => {
				reentrant = executor.execute(key("one"));
			});
			return gate.promise;
		});
		const active = executor.execute(key("one"));
		await Promise.resolve();
		const waiting = Array.from({ length: 32 }, () => executor.execute(key("one")));
		form.reset();
		expect(await Promise.all([active, ...waiting])).toEqual(Array.from({ length: 33 }, () => aborted));
		expect(reentrant).toBeDefined();
		expect(await reentrant).toEqual({ status: "aborted", diagnostic: "action-aborted" });
		gate.reject(new Error("ignored abort"));
		await Promise.resolve();
		executor.dispose();
		runtime.dispose();
		form.dispose();
	});
});
