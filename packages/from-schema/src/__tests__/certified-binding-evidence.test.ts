import { expect, test } from "vitest";
import { createSchemaForm, jsonSchemaProvider } from "../index.js";
import { validationHost } from "./kalada-validation-host-408.js";

test.each([false, true])(
	"only the original validator may authorize a hidden issue; independent copy %s",
	async (copy) => {
		const issue = { source: "extension" as const, path: ["profile", "name"], message: "same" };
		const origin = { validator: 1, ...issue };
		const result = validationHost(undefined, {
			omission: "omit-inactive",
			origin,
			validators: [() => [issue], ...(copy ? [() => [{ ...issue }]] : [])],
		});
		try {
			expect(await result.host.submit()).toEqual({ status: copy ? "denied" : "submitted" });
			const state = result.installed.instances.values().next().value;
			expect(state?.outgoing).toEqual(copy ? undefined : { ...result.host.snapshot().data, profile: {} });
		} finally {
			result.host.dispose();
		}
	},
);

test("retired binding certification cannot be constructed through the legacy schema API", () => {
	expect(() => createSchemaForm({}, { provider: jsonSchemaProvider(), side: "input", fieldValidators: [] })).toThrow(
		/no longer supported/,
	);
});
