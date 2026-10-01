import { expect, test } from "vitest";
import { createSchemaForm, jsonSchemaProvider } from "../index.js";
import { hostSchema, validationHost } from "./kalada-validation-host-408.js";

test("integrated draft validation, omission and FINAL validation bind one outgoing revision", async () => {
	const seen: unknown[] = [];
	const result = validationHost(hostSchema, {
		omission: "omit-inactive",
		validators: [
			(data) => {
				seen.push(data);
				return [];
			},
		],
	});
	try {
		const before = result.host.snapshot();
		expect(await result.host.submit()).toEqual({ status: "submitted" });
		const state = result.installed.instances.values().next().value;
		expect(state?.outgoing).toEqual({ profile: {}, rows: before.data.rows });
		expect(seen).toContainEqual(before.data);
		expect(seen).toContainEqual(state?.outgoing);
		expect(result.host.snapshot().data).toEqual(before.data);
		expect(result.host.snapshot().revision).toBe(before.revision);
	} finally {
		result.host.dispose();
	}
});

test("retired integrated bound FormApi entry cannot bypass host proof", () => {
	expect(() => createSchemaForm(hostSchema, { provider: jsonSchemaProvider(), side: "input" })).toThrow(
		/no longer supported/,
	);
});

test("a revoked host grant denies the integrated submission without outgoing bytes", async () => {
	const result = validationHost();
	try {
		result.installed.revoke();
		expect(await result.host.submit()).not.toEqual({ status: "submitted" });
		expect(result.installed.instances.values().next().value?.outgoing).toBeUndefined();
	} finally {
		result.host.dispose();
	}
});
