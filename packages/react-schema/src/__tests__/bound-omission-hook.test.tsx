// @vitest-environment jsdom
import type { FormApi } from "@formbar/core";
import { jsonSchemaProvider } from "@formbar/from-schema";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { useSchemaForm } from "../use-schema-form.js";

describe("#226 deferred schema hook", () => {
	it("forwards authored policy and activates its bound supplier before submit", async () => {
		const onSubmit = vi.fn(async () => ({ ok: true as const }));
		let form: FormApi<{ show: boolean; secret: string }, object> | undefined;
		function Hook() {
			form = useSchemaForm<{ show: boolean; secret: string }, object>(
				{},
				{
					provider: jsonSchemaProvider(),
					side: "input",
					submission: { hiddenValues: "omit-inactive" },
					definition: {
						version: 1,
						id: "hidden",
						submission: { hiddenValues: "omit-inactive" },
						root: {
							type: "field",
							id: "secret",
							widget: "text",
							binding: { namespace: "data", segments: ["secret"] },
							visible: { kind: "ref", ref: { namespace: "data", segments: ["show"] } },
						},
					},
					initialData: { show: false, secret: "retained" },
					onSubmit,
				},
			).form;
			return null;
		}
		globalThis.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(document.createElement("div"));
		await act(async () => root.render(<Hook />));
		let result: Awaited<ReturnType<NonNullable<typeof form>["submit"]>> | undefined;
		await act(async () => {
			result = await form?.submit();
		});
		expect(result).toMatchObject({ ok: true });
		expect(onSubmit.mock.calls[0]?.[0].payload).toEqual({ show: false });
		expect(form?.getState().data.secret).toBe("retained");
		await act(async () => root.unmount());
	});

	it("forwards generated omission into the activated checked request without clearing the draft", async () => {
		const onSubmit = vi.fn(async () => ({ ok: true as const }));
		let form: FormApi<{ secret: string; name: string }, object> | undefined;
		function Hook() {
			form = useSchemaForm<{ secret: string; name: string }, object>(
				{ type: "object", properties: { secret: { type: "string" }, name: { type: "string" } } },
				{
					provider: jsonSchemaProvider(),
					side: "input",
					submission: { hiddenValues: "omit-inactive" },
					initialData: { secret: "draft", name: "Ada" },
					plugins: [{ id: "hide", evaluate: () => ({ fieldPolicy: [{ path: "secret", visible: false }] }) }],
					onSubmit,
				},
			).form;
			return null;
		}
		globalThis.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(document.createElement("div"));
		await act(async () => root.render(<Hook />));
		await act(async () => {
			expect(await form?.submit()).toMatchObject({ ok: true });
		});
		expect(onSubmit.mock.calls[0]?.[0].payload).toEqual({ name: "Ada" });
		expect(form?.getState().data).toEqual({ secret: "draft", name: "Ada" });
		await act(async () => root.unmount());
	});
});
