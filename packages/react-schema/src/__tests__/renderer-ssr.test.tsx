// @vitest-environment jsdom
import { createForm } from "@formbar/core";
import type { FormDefinition } from "@formbar/declarative";
import { createSchemaForm, jsonSchemaProvider } from "@formbar/from-schema";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FormRenderer } from "../index.js";
import { binding } from "./renderer-test-utils.js";

describe("renderer SSR", () => {
	it("renders and hydrates stable IDs without mismatch diagnostics", async () => {
		const definition: FormDefinition = {
			version: 1,
			id: "ssr",
			root: { type: "field", id: "a.b/雪✨[]", binding: binding("name"), widget: "text", label: "Name" },
		};
		const prepared = createSchemaForm(
			{ type: "object", properties: { name: { type: "string" } } },
			{ provider: jsonSchemaProvider(), side: "input", definition },
		);
		const form = createForm({ initialData: { name: "Ada" }, initialUiState: {} });
		const renderer = <FormRenderer {...prepared} form={form} />;
		const html = renderToString(renderer);
		const container = document.createElement("div");
		container.innerHTML = html;
		document.body.append(container);
		const serverId = container.querySelector("input")?.id;
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		let root: ReturnType<typeof hydrateRoot>;
		await act(async () => {
			root = hydrateRoot(container, renderer);
			await Promise.resolve();
		});
		expect(container.querySelector("input")?.id).toBe(serverId);
		expect(serverId).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(error).not.toHaveBeenCalled();
		act(() => root.unmount());
		error.mockRestore();
		container.remove();
		form.dispose();
	});
});
