import { expect, test } from "vitest";
import { createSchemaForm, jsonSchemaProvider } from "../index.js";
import { validationHost } from "./kalada-validation-host-408.js";

test("generated host control owns value and checked direct writes refresh the revision", async () => {
	const result = validationHost();
	try {
		const before = result.host.snapshot();
		const name = before.controls.find((control) => control.nodeId === result.nameId);
		expect(name).toMatchObject({ value: "original", rendererId: "text" });
		expect(name?.writers.value?.("Grace")).toEqual({ status: "applied" });
		expect(result.host.snapshot().data.profile).toEqual({ name: "Grace" });
		expect(result.host.snapshot().revision).not.toBe(before.revision);
		expect(name?.writers.value?.("stale")).not.toEqual({ status: "applied" });
		expect(await result.host.submit()).toEqual({ status: "submitted" });
		expect(result.installed.instances.values().next().value?.outgoing).toEqual(result.host.snapshot().data);
		expect(result.host.reset()).toMatchObject({ ok: true });
		expect(result.host.snapshot().data.profile).toEqual({ name: "original" });
	} finally {
		result.host.dispose();
	}
});

test("retired runtime baseline FormApi path fails before installation", () => {
	expect(() => createSchemaForm({}, { provider: jsonSchemaProvider(), side: "input" })).toThrow(/no longer supported/);
});

test("nested row control keeps host identity across reorder and rejects its stale writer", async () => {
	const result = validationHost();
	try {
		const original = result.host.snapshot().controls.find((item) => item.nodeId === result.quantityId);
		expect(original?.value).toBe("child");
		expect(original?.writers.value?.("edited")).toEqual({ status: "applied" });
		const state = result.installed.instances.values().next().value;
		if (!state) throw Error("missing host state");
		expect(state.rows[0].nested[0].quantity).toBe("edited");
		state.rows.reverse();
		result.installed.bump(state);
		const moved = result.host.snapshot().controls.find((item) => item.nodeId === result.quantityId);
		expect(moved?.key).toBe(original?.key);
		expect(original?.writers.value?.("stale")).not.toEqual({ status: "applied" });
		expect(await result.host.submit()).toEqual({ status: "submitted" });
		expect(state.outgoing).toEqual(result.host.snapshot().data);
	} finally {
		result.host.dispose();
	}
});
