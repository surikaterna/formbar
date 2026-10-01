import { expect, test } from "vitest";
import { validationHost } from "./kalada-validation-host-408.js";

test("concurrent schema and async extension validators settle before host submission", async () => {
	let release!: () => void;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	const seen: unknown[] = [];
	const fixture = validationHost(undefined, {
		validators: [
			async (data) => {
				seen.push(data);
				await pending;
				return [];
			},
		],
	});
	try {
		const state = fixture.installed.instances.values().next().value;
		if (!state) throw Error("missing installed instance");
		const running = fixture.host.submit();
		expect(state.outgoing).toBeUndefined();
		release();
		expect(await running).toEqual({ status: "submitted" });
		expect(seen).toEqual([state.outgoing]);
		expect(state.issueRecords).toEqual([]);
	} finally {
		release();
		fixture.host.dispose();
	}
});

test("host validate publishes extension issues without committing outgoing data", async () => {
	const fixture = validationHost(undefined, {
		validators: [async () => [{ path: ["profile", "name"], message: "invalid", source: "extension" }]],
	});
	try {
		const state = fixture.installed.instances.values().next().value;
		if (!state) throw Error("missing installed instance");
		expect(await fixture.host.validate()).toEqual({ ok: true, value: undefined });
		expect(fixture.host.snapshot().lifecycle?.valid).toBe(false);
		expect(state.issueRecords).toEqual(
			expect.arrayContaining([expect.objectContaining({ path: ["profile", "name"], source: "extension" })]),
		);
		expect(state.outgoing).toBeUndefined();
	} finally {
		fixture.host.dispose();
	}
});
