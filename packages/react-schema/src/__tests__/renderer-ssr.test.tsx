// @vitest-environment jsdom
import { createForm } from "@formbar/core";
import type { FormDefinition } from "@formbar/declarative";
import { createSchemaForm, jsonSchemaProvider } from "@formbar/from-schema";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FormRenderer } from "../index.js";
import type { RendererContext, WidgetProps } from "../index.js";
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

	it("hydrates custom widgets, custom nodes, tabs, and accordion without mismatches", async () => {
		const definition: FormDefinition = {
			version: 1,
			id: "extension-ssr",
			root: {
				type: "group",
				id: "root",
				children: [
					{
						type: "custom",
						id: "card",
						renderer: "demo.card",
						children: [{ type: "field", id: "custom-value", binding: binding("custom"), widget: "demo.input" }],
					},
					{
						type: "tabs",
						id: "tabs",
						tabs: [
							{
								id: "one",
								label: "One",
								children: [{ type: "field", id: "tab-value", binding: binding("tab"), widget: "text" }],
							},
							{ id: "two", label: "Two", children: [] },
						],
					},
					{
						type: "accordion",
						id: "accordion",
						items: [
							{
								id: "first",
								label: "First",
								children: [{ type: "field", id: "accordion-value", binding: binding("accordion"), widget: "text" }],
							},
						],
					},
				],
			},
		};
		const prepared = createSchemaForm(
			{
				type: "object",
				properties: { custom: { type: "string" }, tab: { type: "string" }, accordion: { type: "string" } },
			},
			{ provider: jsonSchemaProvider(), side: "input", definition },
		);
		const form = createForm({ initialData: { custom: "A", tab: "B", accordion: "C" }, initialUiState: {} });
		const extensions = {
			widgets: [
				{
					id: "demo.input",
					component: (props: WidgetProps) => <input id={props.a11y.controlId} value={String(props.value)} readOnly />,
				},
			],
			nodes: [
				{
					id: "demo.card",
					component: (props: RendererContext) => <section data-card="">{props.children}</section>,
				},
			],
		};
		const renderer = <FormRenderer {...prepared} form={form} extensions={extensions} />;
		const html = renderToString(renderer);
		const container = document.createElement("div");
		container.innerHTML = html;
		document.body.append(container);
		const ids = [...container.querySelectorAll<HTMLElement>("[id]")].map((element) => element.id);
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		let root: ReturnType<typeof hydrateRoot>;
		await act(async () => {
			root = hydrateRoot(container, renderer);
			await Promise.resolve();
		});
		expect([...container.querySelectorAll<HTMLElement>("[id]")].map((element) => element.id)).toEqual(ids);
		expect(container.querySelectorAll('[role="tabpanel"]')).toHaveLength(2);
		expect(container.querySelectorAll('[role="region"]')).toHaveLength(1);
		expect(error).not.toHaveBeenCalled();
		act(() => root.unmount());
		error.mockRestore();
		container.remove();
		form.dispose();
	});
});
