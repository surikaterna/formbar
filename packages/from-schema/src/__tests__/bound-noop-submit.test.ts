import { activateBoundSubmit, boundSubmitStore } from "@formbar/core/internal/submit-proof";
import { expect, test, vi } from "vitest";
import { createSchemaForm, jsonSchemaProvider } from "../index.js";

const context = { requestId: "noop", at: "now" };

function fixture(override = false) {
	const seen: { data: unknown; uiState: unknown; stage?: string; context?: unknown }[] = [];
	const record = (input: { data: unknown; uiState: unknown; stage?: string; context?: unknown }) => {
		seen.push(input);
		return [];
	};
	const caller = (input: Parameters<typeof record>[0]) => record(input);
	const prepared = createSchemaForm(
		{
			type: "object",
			properties: { show: { type: "boolean" }, secret: { type: "string" }, name: { type: "string" } },
			if: { properties: { show: { const: true } } },
			then: { required: ["secret"] },
		},
		{
			provider: jsonSchemaProvider(),
			side: "input",
			validators: [record],
			definition: {
				version: 1,
				id: "noop",
				submission: { hiddenValues: "omit-inactive" },
				root: {
					type: "group",
					id: "root",
					children: [
						{
							type: "field",
							id: "secret",
							widget: "text",
							binding: { namespace: "data", segments: ["secret"] },
							visible: { kind: "ref", ref: { namespace: "data", segments: ["show"] } },
							...(override ? { submitWhenHidden: "include" as const } : {}),
						},
						{ type: "field", id: "name", widget: "text", binding: { namespace: "data", segments: ["name"] } },
					],
				},
			},
		},
	);
	const handler = vi.fn(async () => ({ ok: true as const }));
	const form = prepared.createForm({
		initialData: { show: false, secret: "draft", name: "Ada", extra: "before" },
		initialUiState: { tab: "review" },
		validators: [caller],
		asyncValidators: [{ id: "async", validate: async (input) => record(input) }],
		transforms: [{ id: "edit", phase: "egress", transform: (data) => ({ ...data, extra: "after" }) }],
		onSubmit: handler,
	});
	if (!boundSubmitStore(form)) throw Error("missing bound store");
	activateBoundSubmit(form);
	return { form, handler, seen };
}

test.each([false, true])("#338 real bound hide/submit/show/retry; include override %s", async (override) => {
	const { form, handler, seen } = fixture(override);
	const draft = form.getState().data;
	const hidden = await form.submit(context);
	expect(hidden.ok).toBe(true);
	expect(handler).toHaveBeenCalledTimes(1);
	expect(handler.mock.calls[0]?.[0]).toMatchObject({
		payload: override
			? { show: false, secret: "draft", name: "Ada", extra: "after" }
			: { show: false, name: "Ada", extra: "after" },
	});
	expect(form.getState().data).toEqual(draft);
	form.setValue("show", true);
	seen.length = 0;
	const shown = await form.submit(context);
	expect(shown.ok).toBe(true);
	expect(handler).toHaveBeenCalledTimes(2);
	const payload = handler.mock.calls[1]?.[0]?.payload;
	expect(payload).toEqual({ show: true, secret: "draft", name: "Ada", extra: "after" });
	expect(Object.isFrozen(payload)).toBe(true);
	expect(seen).toHaveLength(3);
	for (const input of seen) {
		expect(input.data).toBe(payload);
		expect(input.uiState).toEqual({ tab: "review" });
		expect(input.context).toMatchObject(context);
	}
	expect(form.getState().data).toEqual({ show: true, secret: "draft", name: "Ada", extra: "before" });
	form.dispose();
});
