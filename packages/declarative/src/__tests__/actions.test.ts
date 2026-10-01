import { describe, expect, it } from "vitest";
import { installedField } from "./kalada-runtime-fixtures.js";

describe("#376 checked host operations instead of FormApi actions", () => {
	it("writes through the installed host only with current revision evidence", () => {
		const { runtime, state, host } = installedField();
		const old = runtime.snapshot().controls[0]?.writers.value;
		expect(old?.("Grace")).toEqual({ status: "applied" });
		expect(state.field.value).toBe("Grace");
		expect(host.notifications).toHaveBeenCalled();
		expect(old?.("obsolete")).toEqual({ status: "stale" });
		expect(runtime.snapshot().controls[0]?.value).toBe("Grace");
		runtime.dispose();
	});

	it("submits the host's whole data rather than an action payload", async () => {
		const { runtime, host } = installedField();
		const data = runtime.snapshot().data;
		expect(await runtime.submit()).toEqual({ status: "submitted" });
		expect(host.submissions).toEqual([data]);
		runtime.dispose();
	});

	it.each([
		["host.save", "action", "MISSING_POLICY"],
		["array.append", "payload", "INVALID_ACTION_PAYLOAD"],
		["array.insert", "payload", "INVALID_ACTION_PAYLOAD"],
		["array.remove", "target", "INVALID_ACTION_TARGET"],
		["array.move", "payload", "INVALID_ACTION_PAYLOAD"],
		["array.swap", "payload", "INVALID_ACTION_PAYLOAD"],
	])("rejects %s without required authority at its authored %s slot", (action, slot, message) => {
		const { runtime, candidate, admit } = installedField();
		expect(admit({ ...candidate, root: { type: "action", id: "run", action } })).toMatchObject({
			ok: false,
			diagnostics: [{ path: ["root", slot], message }],
		});
		runtime.dispose();
	});

	it.each(["submit", "validate", "reset"])("admits host-owned %s action", (action) => {
		const { runtime, candidate, admitOutput } = installedField();
		const result = admitOutput({ ...candidate, root: { type: "action", id: "run", action } });
		expect(result.ok).toBe(true);
		runtime.dispose();
	});
});
