import { describe, expect, it, vi } from "vitest";
import { createForm } from "../create-form.js";
import type { FormPlugin } from "../plugin-types.js";

describe("submit plugin gating", () => {
	it("keeps plugin beforeSubmit after middleware validation and afterAction, without skipping later plugins", async () => {
		const trace: string[] = [];
		const form = createForm({
			initialData: { value: 1 },
			middleware: [
				{
					id: "trace",
					beforeValidate: () => {
						trace.push("beforeValidate");
					},
					afterValidate: () => {
						trace.push("afterValidate");
					},
					beforeSubmit: () => {
						trace.push("middlewareSubmit");
						return { action: "continue" };
					},
					afterAction: () => {
						trace.push("afterAction");
					},
				},
			],
			plugins: [
				{
					id: "first",
					beforeSubmit: () => {
						trace.push("first");
						return [
							{
								code: "STOP",
								message: "stop",
								severity: "error",
								path: { namespace: "data", segments: ["value"] },
								source: { origin: "submit", validatorId: "first" },
							},
						];
					},
				},
				{
					id: "second",
					beforeSubmit: () => {
						trace.push("second");
						return [];
					},
				},
			],
			onSubmit: () => {
				trace.push("handler");
				return { ok: true, submitId: "done" };
			},
		});
		trace.length = 0;
		const result = await form.submit();
		expect(result.reason).toBe("validation-failed");
		expect(trace).toEqual(["beforeValidate", "afterValidate", "middlewareSubmit", "afterAction", "first", "second"]);
		expect(form.getState().issues.map((issue) => issue.code)).toEqual(["STOP"]);
	});

	it("passes typed data and UI state to beforeSubmit and blocks on returned issues", async () => {
		type Data = { email: string };
		type Ui = { confirmed: boolean };
		const contexts: Array<{ email: string; confirmed: boolean }> = [];
		const plugin: FormPlugin<Data, Ui> = {
			id: "confirmation-gate",
			beforeSubmit: ({ data, uiState }) => {
				contexts.push({ email: data.email, confirmed: uiState.confirmed });
				return [
					{
						code: "CONFIRMATION_REQUIRED",
						message: "Confirm before submitting",
						severity: "error",
						path: { namespace: "ui", segments: ["confirmed"] },
						source: { origin: "submit", validatorId: "confirmation-gate" },
					},
				];
			},
		};
		const onSubmit = vi.fn().mockResolvedValue({ ok: true, submitId: "submitted" });
		const form = createForm<Data, Ui>({
			initialData: { email: "user@example.com" },
			initialUiState: { confirmed: false },
			plugins: [plugin],
			onSubmit,
		});

		const result = await form.submit();

		expect(contexts).toEqual([{ email: "user@example.com", confirmed: false }]);
		expect(result).toMatchObject({ ok: false, message: "Validation failed" });
		expect(form.getState().issues).toContainEqual(expect.objectContaining({ code: "CONFIRMATION_REQUIRED" }));
		expect(onSubmit).not.toHaveBeenCalled();
	});
});
