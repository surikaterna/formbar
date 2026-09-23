// @vitest-environment jsdom
import { createForm } from "@formbar/core";
import type { FormApi } from "@formbar/core";
import type { FormDefinition } from "@formbar/declarative";
import { createSchemaForm, jsonSchemaProvider } from "@formbar/from-schema";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FormRenderer, useSchemaForm } from "../index.js";
import type { RendererContext, WidgetProps } from "../index.js";
import { binding, input } from "./renderer-test-utils.js";

const hookSchema = { type: "object", properties: { name: { type: "string", title: "Name" } } };
const hookDefinition: FormDefinition = {
	version: 1,
	id: "hook-ssr",
	root: { type: "field", id: "name", binding: binding("name"), widget: "text", label: "Name" },
};
const hookProvider = jsonSchemaProvider();

function SchemaHookRenderer(props: { readonly capture: (form: FormApi<{ name: string }, { panel: string }>) => void }) {
	const prepared = useSchemaForm<{ name: string }, { panel: string }>(hookSchema, {
		provider: hookProvider,
		side: "input",
		definition: hookDefinition,
		initialData: { name: "Ada" },
		initialUiState: { panel: "details" },
		autoFocusOnError: false,
	});
	props.capture(prepared.form);
	return <FormRenderer {...prepared} />;
}

function countFindPredicates(run: () => void): number {
	let operations = 0;
	const original = Array.prototype.find;
	const find = vi.spyOn(Array.prototype, "find").mockImplementation(function (predicate, thisArg) {
		return Reflect.apply(original, this, [
			(value: unknown, index: number, values: unknown[]) => {
				operations += 1;
				return Reflect.apply(predicate, thisArg, [value, index, values]);
			},
		]);
	});
	try {
		run();
		return operations;
	} finally {
		find.mockRestore();
	}
}

describe("renderer SSR", () => {
	it("renders, hydrates, and updates through public useSchemaForm", async () => {
		const serverForms: FormApi<{ name: string }, { panel: string }>[] = [];
		const html = renderToString(<SchemaHookRenderer capture={(form) => serverForms.push(form)} />);
		expect(html).toContain("Ada");
		expect(html).toContain('data-formbar-definition="hook-ssr"');
		for (const form of serverForms) form.dispose();
		const clientForms: FormApi<{ name: string }, { panel: string }>[] = [];
		const capture = (form: FormApi<{ name: string }, { panel: string }>) => {
			if (!clientForms.includes(form)) clientForms.push(form);
		};
		const container = document.createElement("div");
		container.innerHTML = html;
		document.body.append(container);
		const serverIds = [...container.querySelectorAll<HTMLElement>("[id]")].map((element) => element.id);
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const recoverable: unknown[] = [];
		let root: ReturnType<typeof hydrateRoot>;
		await act(async () => {
			root = hydrateRoot(container, <SchemaHookRenderer capture={capture} />, {
				onRecoverableError: (diagnostic) => recoverable.push(diagnostic),
			});
			await Promise.resolve();
		});
		expect([...container.querySelectorAll<HTMLElement>("[id]")].map((element) => element.id)).toEqual(serverIds);
		const control = container.querySelector("input") as HTMLInputElement;
		expect(control.value).toBe("Ada");
		input(control, "Grace");
		expect(clientForms[0]?.getState().data.name).toBe("Grace");
		expect(control.value).toBe("Grace");
		expect(recoverable).toEqual([]);
		expect(error).not.toHaveBeenCalled();
		act(() => root.unmount());
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(clientForms[0]?.isDisposed()).toBe(false);
		clientForms[0]?.dispose();
		error.mockRestore();
		container.remove();
	});

	it("renders 100, 200, and 500 rows with bounded array-search operations", () => {
		const prepared = createSchemaForm(
			{
				type: "object",
				properties: {
					rows: {
						type: "array",
						items: {
							type: "object",
							properties: Object.fromEntries(
								Array.from({ length: 5 }, (_, index) => [`value${index}`, { type: "string" }]),
							),
						},
					},
				},
			},
			{ provider: jsonSchemaProvider(), side: "input" },
		);
		const operations = [100, 200, 500].map((rowCount) => {
			const rows = Array.from({ length: rowCount }, (_, row) =>
				Object.fromEntries(Array.from({ length: 5 }, (_, field) => [`value${field}`, `${row}:${field}`])),
			);
			const form = createForm({ initialData: { rows }, initialUiState: {} });
			const predicates = countFindPredicates(() => {
				renderToString(<FormRenderer {...prepared} form={form} />);
			});
			form.dispose();
			return { rowCount, predicates };
		});

		expect(operations).toEqual([
			{ rowCount: 100, predicates: 0 },
			{ rowCount: 200, predicates: 0 },
			{ rowCount: 500, predicates: 0 },
		]);
	});

	it("hydrates generated repeater rows with deterministic IDs and no mismatch", async () => {
		const prepared = createSchemaForm(
			{ type: "object", properties: { rows: { type: "array", title: "Rows", items: { type: "string" } } } },
			{ provider: jsonSchemaProvider(), side: "input" },
		);
		const form = createForm({ initialData: { rows: ["one", "two"] }, initialUiState: {} });
		const renderer = <FormRenderer {...prepared} form={form} />;
		const container = document.createElement("div");
		container.innerHTML = renderToString(renderer);
		document.body.append(container);
		const serverIds = [...container.querySelectorAll("[id]")].map((element) => element.id);
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		let root: ReturnType<typeof hydrateRoot>;
		await act(async () => {
			root = hydrateRoot(container, renderer);
			await Promise.resolve();
		});
		expect([...container.querySelectorAll("[id]")].map((element) => element.id)).toEqual(serverIds);
		expect(error).not.toHaveBeenCalled();
		act(() => root.unmount());
		error.mockRestore();
		container.remove();
		form.dispose();
	});

	it("renders and hydrates action controls without mismatches", async () => {
		const definition: FormDefinition = {
			version: 1,
			id: "action-ssr",
			root: { type: "action", id: "save", action: "host.save", label: "Save" },
		};
		const prepared = createSchemaForm(
			{ type: "object", properties: { name: { type: "string" } } },
			{ provider: jsonSchemaProvider(), side: "input", definition },
		);
		const form = createForm({ initialData: { name: "Ada" }, initialUiState: {} });
		const actions = [{ id: "host.save", handler: () => undefined }];
		const renderer = <FormRenderer {...prepared} form={form} actions={actions} />;
		const html = renderToString(renderer);
		const container = document.createElement("div");
		container.innerHTML = html;
		document.body.append(container);
		const describedBy = container.querySelector("button")?.getAttribute("aria-describedby");
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		let root: ReturnType<typeof hydrateRoot>;
		await act(async () => {
			root = hydrateRoot(container, renderer);
			await Promise.resolve();
		});
		expect(container.querySelector("button")?.getAttribute("aria-describedby")).toBe(describedBy);
		expect(error).not.toHaveBeenCalled();
		act(() => root.unmount());
		error.mockRestore();
		container.remove();
		form.dispose();
	});

	it.each([
		["omitted", undefined, "Calculated value"],
		["empty", "", "Calculated value"],
		["whitespace-only", " \t ", "Calculated value"],
		["authored", "  Total  ", "  Total  "],
	] as const)("renders and hydrates %s output labels without mismatches", async (_name, authored, expected) => {
		const definition: FormDefinition = {
			version: 1,
			id: "output-ssr",
			root: {
				type: "output",
				id: "total",
				...(authored === undefined ? {} : { label: authored }),
				format: "currency-usd",
				value: { kind: "ref", ref: binding("total") },
			},
		};
		const prepared = createSchemaForm(
			{ type: "object", properties: { total: { type: "number" } } },
			{ provider: jsonSchemaProvider(), side: "input", definition },
		);
		const form = createForm({ initialData: { total: 12.5 }, initialUiState: {} });
		const renderer = <FormRenderer {...prepared} form={form} />;
		const html = renderToString(renderer);
		const container = document.createElement("div");
		container.innerHTML = html;
		document.body.append(container);
		const serverOutput = container.querySelector("output");
		const serverLabel = serverOutput?.getAttribute("aria-labelledby");
		expect(serverLabel ? document.getElementById(serverLabel)?.textContent : undefined).toBe(expected);
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		let root: ReturnType<typeof hydrateRoot>;
		await act(async () => {
			root = hydrateRoot(container, renderer);
			await Promise.resolve();
		});
		expect(container.querySelector("output")?.textContent).toBe("$12.50");
		expect(container.querySelector("output")?.getAttribute("aria-labelledby")).toBe(serverLabel);
		expect(serverLabel ? document.getElementById(serverLabel)?.textContent : undefined).toBe(expected);
		expect(error).not.toHaveBeenCalled();
		act(() => root.unmount());
		error.mockRestore();
		container.remove();
		form.dispose();
	});

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
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const html = renderToString(renderer);
		const container = document.createElement("div");
		container.innerHTML = html;
		document.body.append(container);
		const ids = [...container.querySelectorAll<HTMLElement>("[id]")].map((element) => element.id);
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
