import { describe, expect, it } from "vitest";
import { installedField } from "./kalada-runtime-fixtures.js";

describe("#376 stale host writes under pressure, not JS handler queues", () => {
	it("rejects every retained writer after a host revision change, without mutating data", () => {
		const { runtime, state, host } = installedField();
		const callbacks = Array.from({ length: 64 }, () => runtime.snapshot().controls[0]?.writers.value);
		state.field.value = "current";
		host.bump(state);
		for (const callback of callbacks) expect(callback?.("old")).toEqual({ status: "stale" });
		expect(state.field.value).toBe("current");
		expect(runtime.snapshot().data).toMatchObject({ profile: { name: "current" } });
		runtime.dispose();
	});

	it("rejects unregistered queued handlers but admits host-owned reset (#407)", () => {
		const { runtime, candidate, admit, admitOutput } = installedField();
		expect(
			admit({ ...candidate, root: { type: "action", id: "run", action: "host.run", concurrency: "queue" } }),
		).toMatchObject({
			ok: false,
			diagnostics: [{ path: ["root", "action"], message: "MISSING_POLICY" }],
		});
		expect(admitOutput({ ...candidate, root: { type: "action", id: "reset", action: "reset" } }).ok).toBe(true);
		runtime.dispose();
	});
});
