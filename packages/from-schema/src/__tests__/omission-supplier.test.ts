import { expect, test } from "vitest";
import { createSchemaForm, jsonSchemaProvider } from "../index.js";
import { validationHost } from "./kalada-validation-host-408.js";

test("host-owned omission candidate is FINAL-validated, not treated as validated draft", async () => {
	const result = validationHost(undefined, {
		omission: "omit-inactive",
		validators: [
			(data) =>
				"name" in (data as { profile: object }).profile
					? []
					: [{ source: "extension", path: ["profile", "name"], message: "required on outgoing" }],
		],
	});
	try {
		const draft = result.host.snapshot().data;
		expect(result.host.snapshot().controls.some((control) => control.nodeId === result.nameId)).toBe(false);
		expect(await result.host.submit()).toEqual({ status: "denied" });
		expect(result.installed.instances.values().next().value?.outgoing).toBeUndefined();
		expect(result.host.snapshot().data).toEqual(draft);
		result.installed.setHidden(false);
		expect(result.host.snapshot().controls.some((control) => control.nodeId === result.nameId)).toBe(true);
		expect(result.host.snapshot().data).toEqual(draft);
		expect(await result.host.submit()).toEqual({ status: "submitted" });
		expect(result.installed.instances.values().next().value?.outgoing).toEqual(draft);
	} finally {
		result.host.dispose();
	}
});

test("legacy omission supplier attachment is not available from retired entry", () => {
	expect(() => createSchemaForm({}, { provider: jsonSchemaProvider(), side: "input", definition: {} })).toThrow(
		/no longer supported/,
	);
});
