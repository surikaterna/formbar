import { describe, expect, it } from "vitest";
import { disposeDemoSession, installDemoSession } from "../runtime/kalada-demo-install";
import type { Issue } from "../runtime/kalada-demo-store";
import { auditDocument, deferred, installedAudit } from "./kalada-audit-fixtures";

describe("R2 owned deferred validation", () => {
	it.each(["edit", "reset", "reinstall", "dispose"])(
		"retires validating on %s without waiting for the old promise",
		async (retirement) => {
			const pending = deferred<readonly Issue[]>();
			let signal: AbortSignal | undefined;
			const check = (_data: unknown, owned: AbortSignal) => {
				signal = owned;
				return pending.promise;
			};
			const old = installedAudit({ validators: [check] });
			let current = old;
			try {
				const validating = old.validate();
				expect(old.snapshot().lifecycle?.validating).toBe(true);
				if (retirement === "edit") expect(old.snapshot().controls[0].writers.value?.("edited").status).toBe("applied");
				if (retirement === "reset") expect(old.reset().ok).toBe(true);
				if (retirement === "reinstall" || retirement === "dispose") disposeDemoSession(old);
				if (retirement === "reinstall")
					current = installDemoSession(auditDocument, undefined, ["formbar.standard.v1"], old, {}, undefined, {
						validators: [check],
					});
				expect(signal?.aborted).toBe(true);
				if (retirement !== "dispose") expect(current.snapshot().lifecycle?.validating).toBe(false);
				pending.settle([]);
				expect((await validating).ok).toBe(false);
				if (retirement !== "dispose") expect(current.snapshot().lifecycle?.validating).toBe(false);
			} finally {
				disposeDemoSession(current);
			}
		},
	);

	it("an old settlement cannot clear a newer validating generation", async () => {
		const first = deferred<readonly Issue[]>();
		const second = deferred<readonly Issue[]>();
		let calls = 0;
		const host = installedAudit({ validators: [() => (++calls === 1 ? first.promise : second.promise)] });
		try {
			const old = host.validate();
			const current = host.validate();
			first.settle([]);
			expect((await old).ok).toBe(false);
			expect(host.snapshot().lifecycle?.validating).toBe(true);
			second.settle([]);
			expect((await current).ok).toBe(true);
			expect(host.snapshot().lifecycle?.validating).toBe(false);
		} finally {
			disposeDemoSession(host);
		}
	});
});
