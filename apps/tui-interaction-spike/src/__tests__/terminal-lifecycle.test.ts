import { describe, expect, it } from "vitest";
import { createCleanupTransaction, notifySafely } from "../browser-mount.js";
import { type DisposalScheduler, scheduleDisposal } from "../deferred-disposal.js";

describe("production terminal resource transaction", () => {
	it("rolls back a late ResizeObserver observe failure in reverse order", () => {
		const events: string[] = [];
		const transaction = createCleanupTransaction();
		const terminal = transaction.acquire(
			() => "terminal",
			() => events.push("terminal"),
		);
		transaction.acquire(
			() => "scope",
			() => events.push("scope"),
		);
		const observer = transaction.acquire(
			() => ({
				observe: () => {
					throw new Error("late resize failure");
				},
			}),
			() => events.push("observer"),
		);
		let caught: unknown;
		try {
			observer.observe();
		} catch (error) {
			try {
				transaction.rollback(error);
			} catch (rollbackError) {
				caught = rollbackError;
			}
		}
		expect(terminal).toBe("terminal");
		expect(caught).toBeInstanceOf(Error);
		expect(events).toEqual(["observer", "scope", "terminal"]);
	});

	it("attempts every disposer once and returns all cleanup failures", () => {
		const events: string[] = [];
		const transaction = createCleanupTransaction();
		for (const name of ["terminal", "scope", "ink"]) {
			transaction.add(() => {
				events.push(name);
				if (name !== "scope") throw new Error(`${name} failed`);
			});
		}
		const first = transaction.dispose();
		const second = transaction.dispose();
		expect(events).toEqual(["ink", "scope", "terminal"]);
		expect(first.errors).toHaveLength(2);
		expect(second).toEqual({ disposed: false, errors: [] });
	});

	it("does not let throwing observability mask or interrupt cleanup", () => {
		const transaction = createCleanupTransaction();
		let disposed = false;
		transaction.add(() => {
			disposed = true;
		});
		expect(() =>
			notifySafely(() => {
				throw new Error("metric failed");
			}, undefined),
		).not.toThrow();
		transaction.dispose();
		expect(disposed).toBe(true);
	});
});

describe("deferred terminal disposal ownership", () => {
	it("uses the bounded fallback when animation frames are suspended", () => {
		const harness = schedulerHarness(false);
		let disposed = 0;
		const scheduled = scheduleDisposal(
			() => disposed++,
			() => undefined,
			harness.scheduler,
		);
		expect(scheduled.isPending()).toBe(true);
		harness.runFallback();
		expect(disposed).toBe(1);
		expect(scheduled.isPending()).toBe(false);
	});

	it("keeps rapid-remount disposal jobs isolated and idempotent", () => {
		const first = schedulerHarness(true);
		const second = schedulerHarness(true);
		const disposed: string[] = [];
		const oldJob = scheduleDisposal(
			() => disposed.push("old"),
			() => undefined,
			first.scheduler,
		);
		const newJob = scheduleDisposal(
			() => disposed.push("new"),
			() => undefined,
			second.scheduler,
		);
		first.runFrame();
		first.runFallback();
		expect(disposed).toEqual(["old"]);
		expect(newJob.isPending()).toBe(true);
		second.runFallback();
		oldJob.flush();
		expect(disposed).toEqual(["old", "new"]);
	});
});

function schedulerHarness(withFrame: boolean) {
	let frame: (() => void) | undefined;
	let fallback: (() => void) | undefined;
	const scheduler: DisposalScheduler = {
		requestFrame: (callback) => {
			frame = callback;
			return withFrame ? 1 : undefined;
		},
		cancelFrame: () => undefined,
		setFallback: (callback) => {
			fallback = callback;
			return 1 as unknown as ReturnType<typeof setTimeout>;
		},
		clearFallback: () => undefined,
	};
	return { scheduler, runFrame: () => frame?.(), runFallback: () => fallback?.() };
}
