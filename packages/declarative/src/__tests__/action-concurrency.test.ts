import { describe, expect, it } from "vitest";
import { installedField } from "./kalada-runtime-fixtures.js";

describe("#291 host revision-bound submission across asynchronous handoff", () => {
	it("refuses a submitted mixed revision when host policy changes during handoff; retry is fresh", async () => {
		const { runtime, state, host } = installedField();
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		host.setHandoff(() => gate);
		const pending = runtime.submit();
		state.field.value = "new policy revision";
		host.bump(state);
		release();
		expect(await pending).toEqual({ status: "stale" });
		expect(host.submissions).toEqual([]);
		host.setHandoff(async () => {});
		expect(await runtime.submit()).toEqual({ status: "submitted" });
		expect(host.submissions).toEqual([runtime.snapshot().data]);
		runtime.dispose();
	});

	it("denies an old writer after an asynchronous host policy revocation", async () => {
		const { runtime, state, host } = installedField();
		const old = runtime.snapshot().controls[0]?.writers.value;
		await Promise.resolve();
		state.field.readOnly = true;
		host.bump(state);
		expect(old?.("forbidden")).not.toEqual({ status: "applied" });
		expect(state.field.value).toBe("original");
		expect(await runtime.submit()).toEqual({ status: "denied" });
		expect(host.submissions).toEqual([]);
		runtime.dispose();
	});

	it.each(["drop", "replace", "queue"])("rejects old %s JS handler concurrency (#407)", (concurrency) => {
		const { runtime, candidate, admit } = installedField();
		expect(admit({ ...candidate, root: { type: "action", id: "run", action: "host.run", concurrency } })).toMatchObject(
			{ ok: false, diagnostics: [{ path: ["root", "action"], message: "MISSING_POLICY" }] },
		);
		runtime.dispose();
	});
});
