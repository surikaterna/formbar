import { expect, test } from "vitest";
import { createSchemaForm, jsonSchemaProvider } from "../index.js";
import { validationHost } from "./kalada-validation-host-408.js";

test("public host sends omitted FINAL bytes without erasing its owned draft", async () => {
	const result = validationHost(undefined, { omission: "omit-inactive" });
	try {
		const draft = result.host.snapshot().data;
		expect(await result.host.submit()).toEqual({ status: "submitted" });
		expect(result.installed.instances.values().next().value?.outgoing).toEqual({ ...draft, profile: {} });
		expect(result.host.snapshot().data).toEqual(draft);
		expect(await result.host.submit()).toEqual({ status: "submitted" });
		const visible = validationHost(undefined, { omission: "omit-inactive", visible: true });
		try {
			expect(await visible.host.submit()).toEqual({ status: "submitted" });
			expect(visible.installed.instances.values().next().value?.outgoing).toEqual(visible.host.snapshot().data);
		} finally {
			visible.host.dispose();
		}
	} finally {
		result.host.dispose();
	}
});

test("include override preserves a hidden field in outgoing bytes", async () => {
	const result = validationHost(undefined, { omission: "include-hidden" });
	try {
		expect(await result.host.submit()).toEqual({ status: "submitted" });
		expect(result.installed.instances.values().next().value?.outgoing).toEqual(result.host.snapshot().data);
	} finally {
		result.host.dispose();
	}
});

test("legacy public omission entry cannot fall back to unguarded submission", () => {
	expect(() =>
		createSchemaForm(
			{},
			{ provider: jsonSchemaProvider(), side: "input", submission: { hiddenValues: "omit-inactive" } },
		),
	).toThrow(/no longer supported/);
});
