import { expect, test } from "vitest";
import { createSchemaForm, jsonSchemaProvider } from "../index.js";
import { validationHost } from "./kalada-validation-host-408.js";

test("generated schema and async extension validate both draft and exact FINAL candidate", async () => {
	const seen: unknown[] = [];
	const result = validationHost(undefined, {
		omission: "omit-inactive",
		validators: [
			async (data) => {
				seen.push(data);
				return [];
			},
		],
	});
	try {
		const draft = result.host.snapshot().data;
		expect(await result.host.submit()).toEqual({ status: "submitted" });
		const outgoing = result.installed.instances.values().next().value?.outgoing;
		expect(outgoing).toEqual({ ...draft, profile: {} });
		expect(seen).toEqual([draft, outgoing]);
	} finally {
		result.host.dispose();
	}
});

test("FINAL-only required schema issue blocks the checked submit", async () => {
	const schema = {
		type: "object",
		properties: { profile: { type: "object", required: ["name"], properties: { name: { type: "string" } } } },
	};
	const result = validationHost(schema, { omission: "omit-inactive" });
	try {
		expect(await result.host.submit()).toEqual({ status: "denied" });
		expect(result.installed.instances.values().next().value?.outgoing).toBeUndefined();
		expect(result.host.snapshot().data.profile).toEqual({ name: "original" });
	} finally {
		result.host.dispose();
	}
});

test("legacy prepared validator composition cannot be installed", () => {
	expect(() => createSchemaForm({}, { provider: jsonSchemaProvider(), side: "input", validators: [() => []] })).toThrow(
		/no longer supported/,
	);
});
