// @vitest-environment jsdom
import type { FormApi } from "@formbar/core";
import type { FormDefinition } from "@formbar/declarative";
import { createSchemaForm, jsonSchemaProvider } from "@formbar/from-schema";
import { act } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FormRenderer, useSchemaForm } from "../index.js";

const path = (key: string) => ({ namespace: "data" as const, segments: [key] });
const schema = {
	type: "object",
	properties: { show: { type: "boolean" }, secret: { type: "string" }, alternate: { type: "string" } },
};
const definition: FormDefinition = {
	version: 1,
	id: "conditional-omission",
	submission: { hiddenValues: "omit-inactive" },
	root: {
		type: "conditional",
		id: "choice",
		condition: { kind: "ref", ref: path("show") },
		// biome-ignore lint/suspicious/noThenProperty: Serialized definition contract uses then.
		then: [{ type: "field", id: "secret", binding: path("secret"), widget: "text" }],
		else: [{ type: "field", id: "alternate", binding: path("alternate"), widget: "text", submitWhenHidden: "include" }],
	},
};

describe("opt-in native renderer", () => {
	it("sends omitted request bytes without deleting a mock server's persisted secret", async () => {
		const stored = { show: true, secret: "server-original", alternate: "old" };
		const requests: unknown[] = [];
		const prepared = createSchemaForm<typeof initial, object>(schema, {
			provider: jsonSchemaProvider(),
			side: "input",
			definition: {
				...definition,
				root: {
					type: "field",
					id: "secret",
					widget: "text",
					binding: path("secret"),
					visible: { kind: "ref", ref: path("show") },
				},
			},
		});
		const form = prepared.createForm({
			initialData: initial,
			initialUiState: {},
			onSubmit: async ({ payload }) => {
				requests.push(payload);
				Object.assign(stored, payload);
				return { ok: true };
			},
		});
		expect(await form.submit()).toMatchObject({ ok: true });
		expect(requests).toEqual([{ show: false, alternate: "other" }]);
		expect(stored).toEqual({ show: false, secret: "server-original", alternate: "other" });
		expect(form.getState().data).toEqual(initial);
		form.dispose();
	});

	it("renders failed final candidate issues in summary and field, focuses the error, and retains hidden drafts", async () => {
		const sent: unknown[] = [];
		const prepared = createSchemaForm<typeof initial, object>(schema, {
			provider: jsonSchemaProvider(),
			side: "input",
			definition,
			validators: [
				({ data }) =>
					data.show
						? []
						: [
								{
									path: path("alternate"),
									code: "candidate",
									message: "Fix alternate",
									severity: "error",
									source: { origin: "function-validator", validatorId: "host" },
								},
							],
			],
		});
		const form = prepared.createForm({
			initialData: initial,
			initialUiState: {},
			onSubmit: async ({ payload }) => {
				sent.push(payload);
				return { ok: true };
			},
		});
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		globalThis.IS_REACT_ACT_ENVIRONMENT = true;
		await act(async () => root.render(<FormRenderer {...prepared} form={form} />));
		expect(container.querySelector('[data-formbar-node="secret"]')).toBeNull();
		let result: Awaited<ReturnType<typeof form.submit>> | undefined;
		await act(async () => {
			result = await form.submit();
		});
		expect(result).toMatchObject({ ok: false });
		expect(sent).toEqual([]);
		expect(container.querySelector("[data-formbar-error-summary]")?.textContent).toContain("Fix alternate");
		const alternate = container.querySelector('[data-formbar-node="alternate"] input');
		expect(alternate?.getAttribute("aria-invalid")).toBe("true");
		expect(document.activeElement).toBe(alternate);
		await act(async () => {
			form.setValue("show", true);
			result = await form.submit();
		});
		expect(result).toMatchObject({ ok: true });
		expect(sent).toEqual([{ show: true, secret: "draft", alternate: "other" }]);
		await act(async () => {
			form.setValue("show", false);
		});
		expect(form.getState().data.secret).toBe("draft");
		expect(container.querySelector('[data-formbar-node="secret"]')).toBeNull();
		act(() => root.unmount());
		form.dispose();
		container.remove();
	});
});

const initial = { show: false, secret: "draft", alternate: "other" };

function HookView(props: { capture: (form: FormApi<typeof initial, object>) => void }) {
	const prepared = useSchemaForm<typeof initial, object>(schema, {
		provider: jsonSchemaProvider(),
		side: "input",
		definition,
		initialData: initial,
		initialUiState: {},
		autoFocusOnError: false,
	});
	props.capture(prepared.form);
	return <FormRenderer {...prepared} />;
}

it("hydrates the same opt-in definition, data, UI and policy without replacing native fallback", async () => {
	const server: FormApi<typeof initial, object>[] = [];
	const html = renderToString(<HookView capture={(form) => server.push(form)} />);
	expect(html).toContain('data-formbar-node="alternate"');
	expect(html).not.toContain('data-formbar-node="secret"');
	for (const form of server) form.dispose();
	const container = document.createElement("div");
	container.innerHTML = html;
	document.body.append(container);
	const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
	const recoverable: unknown[] = [];
	const client: FormApi<typeof initial, object>[] = [];
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	let root: ReturnType<typeof hydrateRoot>;
	await act(async () => {
		root = hydrateRoot(container, <HookView capture={(form) => client.push(form)} />, {
			onRecoverableError: (error) => recoverable.push(error),
		});
	});
	expect(container.querySelector("input")?.value).toBe("other");
	expect(recoverable).toEqual([]);
	expect(errors).not.toHaveBeenCalled();
	await act(async () => {
		expect(await client[0]?.submit()).toMatchObject({ ok: true });
	});
	expect(client[0]?.getState().data).toEqual(initial);
	act(() => root.unmount());
	client[0]?.dispose();
	errors.mockRestore();
	container.remove();
});
