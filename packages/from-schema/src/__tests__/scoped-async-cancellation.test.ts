import { expect, test } from "vitest";
import { validationHost } from "./kalada-validation-host-408.js";

test.each(["reset", "dispose", "row revision"] as const)(
	"late extension validation cannot commit after %s",
	async (action) => {
		let release!: () => void;
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		let started!: () => void;
		const entered = new Promise<void>((resolve) => {
			started = resolve;
		});
		const fixture = validationHost(undefined, {
			validators: [
				async () => {
					started();
					await pending;
					return [{ source: "extension", path: ["rows", 0, "nested", 0, "quantity"], message: "late" }];
				},
			],
		});
		try {
			const running = fixture.host.submit();
			await entered;
			const state = fixture.installed.instances.values().next().value;
			if (!state) throw Error("missing installed instance");
			if (action === "reset") expect(fixture.host.reset()).toEqual({ ok: true });
			if (action === "dispose") fixture.host.dispose();
			if (action === "row revision") {
				state.rows.reverse();
				fixture.installed.bump(state);
			}
			const revision = action === "dispose" ? undefined : fixture.host.snapshot().revision;
			release();
			expect(await running).toEqual({ status: "denied" });
			expect(state.outgoing).toBeUndefined();
			if (action !== "dispose") {
				expect(fixture.host.snapshot().revision).toBe(revision);
				expect(fixture.host.snapshot().lifecycle?.issues.extension).toEqual([]);
			}
		} finally {
			release();
			fixture.host.dispose();
		}
	},
);

test("overlapping submission is denied while async validation is pending", async () => {
	let release!: () => void;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	const fixture = validationHost(undefined, {
		validators: [
			async () => {
				await pending;
				return [];
			},
		],
	});
	try {
		const first = fixture.host.submit();
		expect(await fixture.host.submit()).toEqual({ status: "denied" });
		release();
		expect(await first).toEqual({ status: "submitted" });
	} finally {
		release();
		fixture.host.dispose();
	}
});
