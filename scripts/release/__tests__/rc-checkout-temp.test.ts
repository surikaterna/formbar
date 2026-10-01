import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createDenialCheckoutTemp } from "./rc-checkout-temp";

describe("#436 actor-denial checkout cleanup", () => {
	it("retries transient ENOTEMPTY and removes the owned checkout", async () => {
		const transient = Object.assign(new Error("directory not empty"), { code: "ENOTEMPTY" });
		const remove = vi
			.fn<typeof rmSync>()
			.mockImplementationOnce(() => {
				throw transient;
			})
			.mockImplementation(rmSync);
		const fixture = createDenialCheckoutTemp(remove);
		try {
			mkdirSync(join(fixture.dir, "checkout/.git"), { recursive: true });
			writeFileSync(join(fixture.dir, "checkout/.git/index"), "fixture");
			await fixture.cleanup();
			expect(existsSync(fixture.dir)).toBe(false);
			expect(remove).toHaveBeenCalledTimes(2);
			for (const call of remove.mock.calls)
				expect(call).toEqual([fixture.dir, { recursive: true, force: true, maxRetries: 0 }]);
		} finally {
			rmSync(fixture.dir, { recursive: true, force: true });
		}
	});

	it("bounds persistent ENOTEMPTY retries and propagates the exact last error", async () => {
		const errors = Array.from({ length: 4 }, (_, attempt) =>
			Object.assign(new Error(`failure ${attempt}`), { code: "ENOTEMPTY" }),
		);
		let calls = 0;
		const fixture = createDenialCheckoutTemp(() => {
			throw errors[calls++];
		});
		try {
			await expect(fixture.cleanup()).rejects.toBe(errors[3]);
			expect(calls).toBe(4);
			expect(existsSync(fixture.dir)).toBe(true);
		} finally {
			rmSync(fixture.dir, { recursive: true, force: true });
		}
	});

	it.each(["EACCES", "EBUSY", "EPERM"])("does not retry or mask %s", async (code) => {
		const error = Object.assign(new Error(code), { code });
		const remove = vi.fn<typeof rmSync>(() => {
			throw error;
		});
		const fixture = createDenialCheckoutTemp(remove);
		try {
			await expect(fixture.cleanup()).rejects.toBe(error);
			expect(remove).toHaveBeenCalledTimes(1);
		} finally {
			rmSync(fixture.dir, { recursive: true, force: true });
		}
	});
});
