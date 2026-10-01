import { describe, expect, it, vi } from "vitest";
import { installedField, installedOutput } from "./kalada-runtime-fixtures.js";

describe("installed-host subscriptions", () => {
	it("notifies on successful host revision changes, not stale or denied writes", () => {
		const { runtime, state, host } = installedField();
		const listener = vi.fn();
		const stop = runtime.subscribe(listener);
		const writer = runtime.snapshot().controls[0]?.writers.value;
		expect(writer?.("next")).toEqual({ status: "applied" });
		expect(listener).toHaveBeenCalledOnce();
		expect(writer?.("old")).toEqual({ status: "stale" });
		expect(listener).toHaveBeenCalledOnce();
		const currentWriter = runtime.snapshot().controls[0]?.writers.value;
		state.field.readOnly = true;
		host.bump(state);
		expect(currentWriter?.("denied")).not.toEqual({ status: "applied" });
		expect(listener).toHaveBeenCalledTimes(2);
		stop();
		host.bump(state);
		expect(listener).toHaveBeenCalledTimes(2);
		runtime.dispose();
	});

	it("invalidates a subscribed output on revision and refuses stale output after disposal", () => {
		const { runtime, state, host } = installedOutput({
			kind: "ref",
			ref: { namespace: "data", segments: ["profile", "name"] },
		});
		const listener = vi.fn();
		const stop = runtime.subscribe(listener);
		const before = runtime.snapshot();
		state.field.value = "fresh";
		host.bump(state);
		expect(listener).toHaveBeenCalledOnce();
		expect(runtime.snapshot().revision).not.toBe(before.revision);
		expect(runtime.snapshot().outputs[0]?.value).toBe("fresh");
		stop();
		runtime.dispose();
		host.bump(state);
		expect(listener).toHaveBeenCalledOnce();
		expect(runtime.currentRevision()).toBeUndefined();
		expect(() => runtime.snapshot()).toThrow();
	});
});
