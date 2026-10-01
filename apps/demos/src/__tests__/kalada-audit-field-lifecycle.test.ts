import { afterEach, expect, it, vi } from "vitest";
import { disposeDemoSession } from "../runtime/kalada-demo-install";
import type { Issue } from "../runtime/kalada-demo-store";
import { deferred, installedAudit } from "./kalada-audit-fixtures";

afterEach(() => vi.useRealTimers());

it("R3 keeps exact field dirty/touched metadata through issue replacement and blur", async () => {
	const host = installedAudit();
	try {
		expect(host.snapshot().controls[0].writers.value?.("x").status).toBe("applied");
		const changed = host.snapshot();
		expect(changed.controls[0].lifecycle).toMatchObject({ dirty: true, touched: true });
		expect(changed.controls[1].lifecycle).toMatchObject({ dirty: false, touched: false });
		expect((await host.validate()).ok).toBe(false);
		expect(host.snapshot().controls[0].lifecycle).toMatchObject({ dirty: true, touched: true, valid: false });
		expect(host.snapshot().controls[1].onBlur?.().status).toBe("applied");
		expect(host.snapshot().controls[1].lifecycle).toMatchObject({ dirty: false, touched: true });
		expect(host.snapshot().controls[0].writers.value?.("valid").status).toBe("applied");
		expect(host.snapshot().controls[0].lifecycle).toMatchObject({ dirty: true, touched: true, valid: true });
		expect(host.reset().ok).toBe(true);
		expect(host.snapshot().controls.every((control) => !control.lifecycle?.dirty && !control.lifecycle?.touched)).toBe(
			true,
		);
	} finally {
		disposeDemoSession(host);
	}
});

it("R3 scopes real deferred blur validation to the exact owner and fences older completions", async () => {
	vi.useFakeTimers();
	const first = deferred<readonly Issue[]>();
	const second = deferred<readonly Issue[]>();
	let calls = 0;
	const host = installedAudit({
		scopedValidators: [
			{
				id: "name-blur",
				field: "root.children[0]",
				trigger: "onBlur",
				validate: () => (++calls === 1 ? first.promise : second.promise),
			},
		],
	});
	try {
		expect(host.snapshot().controls[0].onBlur?.().status).toBe("applied");
		await vi.runOnlyPendingTimersAsync();
		expect(host.snapshot().controls[0].lifecycle).toMatchObject({ touched: true, validating: true });
		expect(host.snapshot().controls[1].lifecycle).toMatchObject({ touched: false, validating: false });
		expect(host.snapshot().controls[0].writers.value?.("edited").status).toBe("applied");
		expect(host.snapshot().controls[0].onBlur?.().status).toBe("applied");
		await vi.runOnlyPendingTimersAsync();
		first.settle([{ path: [], message: "obsolete", source: "extension" }]);
		await Promise.resolve();
		expect(host.snapshot().controls[0].lifecycle?.validating).toBe(true);
		second.settle([{ path: [], message: "current", source: "extension" }]);
		await Promise.resolve();
		expect(host.snapshot().controls[0].lifecycle).toMatchObject({
			dirty: true,
			touched: true,
			validating: false,
			issues: { extension: ["current"] },
		});
		expect(host.snapshot().controls[1].lifecycle?.issues.extension).toEqual([]);
	} finally {
		disposeDemoSession(host);
	}
});
