import { expect, test } from "vitest";
import { validationHost } from "./kalada-validation-host-408.js";

test("FINAL validates the exact outgoing candidate and never substitutes retained draft", async () => {
	const seen: unknown[] = [];
	const fixture = validationHost(undefined, {
		validators: [
			async (data) => {
				seen.push(data);
				return [];
			},
		],
	});
	try {
		const state = fixture.installed.instances.values().next().value;
		if (!state) throw Error("missing installed instance");
		const writer = fixture.host.snapshot().controls.find((control) => control.nodeId === fixture.quantityId)
			?.writers.value;
		expect(writer?.("outgoing")).toEqual({ status: "applied" });
		const snapshot = fixture.host.snapshot();
		expect(await fixture.host.submit()).toEqual({ status: "submitted" });
		expect(state.outgoing).toEqual(snapshot.data);
		expect(seen).toEqual([snapshot.data]);
		expect((state.outgoing as { rows: { nested: { quantity: string }[] }[] }).rows[0]?.nested[0]?.quantity).toBe(
			"outgoing",
		);
	} finally {
		fixture.host.dispose();
	}
});

test("FINAL extension issue on a nested row blocks outgoing data with path provenance", async () => {
	const path = ["rows", 0, "nested", 0, "quantity"] as const;
	const fixture = validationHost(undefined, {
		validators: [async () => [{ path, source: "extension", message: "row rejected" }]],
	});
	try {
		const state = fixture.installed.instances.values().next().value;
		if (!state) throw Error("missing installed instance");
		const before = fixture.host.snapshot();
		expect(await fixture.host.submit()).toEqual({ status: "denied" });
		expect(state.issueRecords).toEqual(
			expect.arrayContaining([expect.objectContaining({ path, source: "extension", message: "row rejected" })]),
		);
		expect(state.outgoing).toBeUndefined();
		expect(fixture.host.snapshot().data).toEqual(before.data);
	} finally {
		fixture.host.dispose();
	}
});
