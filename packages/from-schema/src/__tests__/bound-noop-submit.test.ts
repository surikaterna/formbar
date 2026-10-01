import { expect, test } from "vitest";
import { createSchemaForm, jsonSchemaProvider } from "../index.js";
import { validationHost } from "./kalada-validation-host-408.js";

test.each(["omit-inactive", "include-hidden"] as const)(
	"%s hide, show and retry use current host candidate",
	async (omission) => {
		const result = validationHost(undefined, { omission });
		try {
			const draft = result.host.snapshot().data;
			expect(await result.host.submit()).toEqual({ status: "submitted" });
			const state = result.installed.instances.values().next().value;
			expect(state?.outgoing).toEqual(omission === "omit-inactive" ? { ...draft, profile: {} } : draft);
			expect(await result.host.submit()).toEqual({ status: "submitted" });
			const visible = validationHost(undefined, { omission, visible: true });
			try {
				expect(await visible.host.submit()).toEqual({ status: "submitted" });
				expect(visible.installed.instances.values().next().value?.outgoing).toEqual(visible.host.snapshot().data);
			} finally {
				visible.host.dispose();
			}
			expect(result.host.snapshot().data).toEqual(draft);
		} finally {
			result.host.dispose();
		}
	},
);

test("retired no-op submit constructor refuses legacy options", () => {
	expect(() =>
		createSchemaForm(
			{},
			{ provider: jsonSchemaProvider(), side: "input", submission: { hiddenValues: "omit-inactive" } },
		),
	).toThrow(/no longer supported/);
});
