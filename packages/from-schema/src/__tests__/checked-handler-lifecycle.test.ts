import { expect, test } from "vitest";
import { createSchemaForm, jsonSchemaProvider } from "../index.js";
import { validationHost } from "./kalada-validation-host-408.js";

test("reset fences pending async FINAL and a fresh submit succeeds without duplicate delivery", async () => {
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const result = validationHost(undefined, {
		validators: [
			async () => {
				await gate;
				return [];
			},
		],
	});
	try {
		const pending = result.host.submit();
		expect(await result.host.submit()).toEqual({ status: "denied" });
		expect(result.host.reset()).toMatchObject({ ok: true });
		const revision = result.host.snapshot().revision;
		release();
		expect(await pending).toEqual({ status: "denied" });
		expect(result.installed.instances.values().next().value?.outgoing).toBeUndefined();
		expect(await result.host.submit()).toEqual({ status: "submitted" });
		expect(result.installed.instances.values().next().value?.outgoing).toEqual(result.host.snapshot().data);
		expect(result.host.snapshot().revision).toBe(revision);
	} finally {
		result.host.dispose();
	}
});

test("legacy checked handler installation fails before a submission can run", () => {
	expect(() => createSchemaForm({}, { provider: jsonSchemaProvider(), side: "input", onSubmit: () => {} })).toThrow(
		/no longer supported/,
	);
});

test("a direct write during pending async validation invalidates the captured outgoing revision", async () => {
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const result = validationHost(undefined, {
		validators: [
			async () => {
				await gate;
				return [];
			},
		],
	});
	try {
		const writer = result.host.snapshot().controls.find((item) => item.nodeId === result.nameId)?.writers.value;
		const pending = result.host.submit();
		expect(writer?.("new value")).toEqual({ status: "applied" });
		release();
		expect(await pending).not.toEqual({ status: "submitted" });
		expect(result.installed.instances.values().next().value?.outgoing).toBeUndefined();
		expect(await result.host.submit()).toEqual({ status: "submitted" });
		expect(result.installed.instances.values().next().value?.outgoing).toEqual(result.host.snapshot().data);
	} finally {
		result.host.dispose();
	}
});
