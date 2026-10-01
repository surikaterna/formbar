// @vitest-environment jsdom
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it } from "vitest";
import type { KaladaV1Host } from "../../../declarative/src/kalada-v1-host.js";
import {
	checkKaladaOutputFormat409,
	checkKaladaPresentation409,
} from "../../../declarative/src/validators/kalada-private-presentation-409.js";
import {
	KaladaAccordion409,
	KaladaRepeaterRows409,
	KaladaTabs409,
	KaladaUnknownRenderer409,
} from "../kalada-collections-409.js";
import { KaladaFormRenderer } from "../kalada-form-renderer.js";
import { KaladaGroup409, KaladaOutput409, KaladaSection409, kaladaLayoutProps409 } from "../kalada-layout-409.js";
import { formatKaladaOutput409 } from "../kalada-output-formatters-409.js";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const disposers: Array<() => void> = [];
afterEach(() => {
	for (const dispose of disposers.splice(0)) dispose();
});

function mount(element: ReactNode) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	act(() => root.render(element));
	disposers.push(() => {
		act(() => root.unmount());
		container.remove();
	});
	return container;
}

it("formats bounded scalar outputs and rejects unsupported or non-JSON values", () => {
	for (const format of ["plain", "number", "currency-usd", "percent"] as const)
		expect(formatKaladaOutput409(null, format)).toEqual({ ok: true, text: "Not available" });
	expect(formatKaladaOutput409("value")).toEqual({ ok: true, text: "value" });
	expect(formatKaladaOutput409(true)).toEqual({ ok: true, text: "True" });
	expect(formatKaladaOutput409(false)).toEqual({ ok: true, text: "False" });
	expect(formatKaladaOutput409(12.345)).toEqual({ ok: true, text: "12.345" });
	expect(formatKaladaOutput409(1234.567, "number")).toEqual({ ok: true, text: "1,234.57" });
	expect(formatKaladaOutput409(1234.5, "currency-usd")).toEqual({ ok: true, text: "$1,234.50" });
	expect(formatKaladaOutput409(0.1234, "percent")).toEqual({ ok: true, text: "12.34%" });
	for (const value of [{ bad: true }, [1], undefined, Number.NaN, Number.POSITIVE_INFINITY, () => 1, Symbol("bad")])
		expect(formatKaladaOutput409(value)).toEqual({ ok: false, diagnostic: "unsupported-output-value" });
	expect(formatKaladaOutput409("3", "number")).toEqual({ ok: false, diagnostic: "unsupported-output-value" });
});

it("validates presentation and output format at their precise definition path", () => {
	expect(checkKaladaOutputFormat409(undefined, "root.format")).toBe("plain");
	expect(checkKaladaOutputFormat409("percent", "root.format")).toBe("percent");
	checkKaladaPresentation409({ span: { sm: "full", md: 6 } }, "root.presentation");
	expect(() => checkKaladaPresentation409({ span: { md: 13 } }, "root.presentation")).toThrow(
		"root.presentation.span.md: INVALID_RANGE",
	);
	expect(() => checkKaladaPresentation409({ span: { giant: 4 } }, "root.presentation")).toThrow(
		"root.presentation.span.giant: UNKNOWN_KEY",
	);
	expect(() => checkKaladaOutputFormat409("money", "root.format")).toThrow("root.format: INVALID_OUTPUT_FORMAT");
});

it("renders sections, groups, spans, output labels and safe diagnostics", () => {
	const html = renderToString(
		<KaladaSection409
			nodeId="section"
			instanceKey="section"
			prefix="form"
			title="Title"
			description="Detail"
			presentation={{ span: { base: 4, md: "full" } }}
		>
			<KaladaGroup409 nodeId="group" instanceKey="group" prefix="form" label="Legend">
				<KaladaOutput409 nodeId="out" instanceKey="out" prefix="form" value={null} />
			</KaladaGroup409>
		</KaladaSection409>,
	);
	expect(html).toContain("<h2");
	expect(html).toContain("<legend");
	expect(html).toContain("aria-describedby=");
	expect(html).toContain("aria-labelledby=");
	expect(html).toContain("Calculated value");
	expect(html).toContain("Not available");
	expect(kaladaLayoutProps409({ span: { base: 4, md: "full" } }).attributes).toEqual({
		"data-formbar-span-base": "4",
		"data-formbar-span-md": "12",
	});
	expect(
		renderToString(<KaladaOutput409 nodeId="bad" instanceKey="bad" prefix="form" value={{ bad: true }} />),
	).toContain('data-formbar-diagnostic="unsupported-output-value"');
	expect(renderToString(<KaladaUnknownRenderer409 nodeId="x" rendererId="unknown" />)).toContain(
		'data-formbar-diagnostic="missing-extension"',
	);
});

const items = [
	{ id: "one", label: "One", renderChildren: () => <input aria-label="first" /> },
	{ id: "two", label: "Two", renderChildren: () => <input aria-label="second" /> },
];

it("keeps tab IDs stable in SSR, selects with keyboard and mounts only selected content", () => {
	const element = <KaladaTabs409 nodeId="tabs" instanceKey="host-row-a" prefix="form" items={items} />;
	expect(renderToString(element)).toBe(renderToString(element));
	const container = mount(element);
	const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
	expect(tabs[0].getAttribute("aria-controls")).toBe(container.querySelector('[role="tabpanel"]')?.id);
	expect(container.querySelector('[aria-label="second"]')).toBeNull();
	act(() => tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
	expect(tabs[1].getAttribute("aria-selected")).toBe("true");
	expect(tabs[1].tabIndex).toBe(0);
	expect(container.querySelector('[aria-label="first"]')).toBeNull();
	expect(container.querySelector('[aria-label="second"]')).not.toBeNull();
});

it("hydrates the same host-derived collection IDs without replacing the SSR controls", () => {
	const element = <KaladaTabs409 nodeId="tabs" instanceKey="host-row-a" prefix="form" items={items} />;
	const container = document.createElement("div");
	container.innerHTML = renderToString(element);
	document.body.append(container);
	const first = container.querySelector('[role="tab"]');
	let root!: ReturnType<typeof hydrateRoot>;
	act(() => {
		root = hydrateRoot(container, element);
	});
	expect(container.querySelector('[role="tab"]')).toBe(first);
	expect(container.querySelector('[role="tab"]')?.getAttribute("aria-controls")).toBe(
		container.querySelector('[role="tabpanel"]')?.id,
	);
	disposers.push(() => {
		act(() => root.unmount());
		container.remove();
	});
});

it("does not mount hidden custom children or expose their writable callbacks", () => {
	let invoked = 0;
	const Hidden = () => {
		invoked++;
		return (
			<button
				type="button"
				onClick={() => {
					invoked++;
				}}
			>
				Write
			</button>
		);
	};
	const container = mount(
		<KaladaTabs409
			nodeId="tabs"
			instanceKey="row"
			prefix="form"
			items={[
				{ id: "visible", label: "Visible", renderChildren: () => <span>Read only</span> },
				{
					id: "hidden",
					label: "Hidden",
					renderChildren: () => {
						invoked++;
						return <Hidden />;
					},
				},
			]}
		/>,
	);
	expect(invoked).toBe(0);
	expect(container.querySelector("button[type=button]:not([role=tab])")).toBeNull();
});

it("passes only projected custom descendants to the installed renderer with their own writers and disabled state", () => {
	const write = () => ({ status: "applied" });
	const host = {
		definition: {
			version: 1,
			id: "presentation",
			root: { type: "custom", id: "layout", renderer: "layout", props: {} },
		},
		currentRevision: () => ({}),
		subscribe: () => () => {},
		snapshot: () => ({
			controls: [
				{
					path: "root",
					key: "custom",
					nodeId: "layout",
					type: "custom",
					rendererId: "layout",
					props: {},
					writers: {},
					disabled: true,
					readOnly: false,
					visible: true,
				},
				{
					path: "root.children[0]",
					key: "child",
					nodeId: "nested",
					type: "field",
					rendererId: "text",
					props: {},
					writers: { value: write },
					disabled: true,
					readOnly: false,
					visible: true,
				},
			],
			outputs: [],
			rows: [],
			data: {},
			revision: {},
			tree: {
				path: "root",
				key: "custom",
				nodeId: "layout",
				type: "custom",
				children: [{ path: "root.children[0]", key: "child", nodeId: "nested", type: "field" }],
			},
		}),
	} as unknown as KaladaV1Host;
	const html = renderToString(
		<KaladaFormRenderer
			host={host}
			renderers={{ layout: ({ children, disabled }) => <section data-disabled={disabled}>{children}</section> }}
		/>,
	);
	expect(html).toContain('data-disabled="true"');
	expect(html).toContain('data-kalada-control="nested"');
	expect(html).toContain('disabled=""');
});

it("accordion keyboard moves focus without opening hidden content; toggle opens it", () => {
	const container = mount(<KaladaAccordion409 nodeId="accordion" instanceKey="row" prefix="form" items={items} />);
	const buttons = container.querySelectorAll<HTMLButtonElement>("h3 button");
	expect(container.querySelector('[aria-label="second"]')).toBeNull();
	act(() => buttons[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
	expect(document.activeElement).toBe(buttons[1]);
	expect(buttons[1].getAttribute("aria-expanded")).toBe("false");
	act(() => buttons[1].click());
	expect(buttons[1].getAttribute("aria-expanded")).toBe("true");
	expect(container.querySelector('[aria-label="second"]')).not.toBeNull();
});

it("keeps host row identity across reorder/removal without rendering callbacks in hidden branches", () => {
	const rows = [
		{ key: "host-a", renderChildren: () => <input defaultValue="A" /> },
		{ key: "host-b", renderChildren: () => <input defaultValue="B" /> },
	];
	const container = document.createElement("div");
	const root = createRoot(container);
	disposers.push(() => act(() => root.unmount()));
	act(() => root.render(<KaladaRepeaterRows409 nodeId="rows" label="Entries" rows={rows} />));
	const first = container.querySelector<HTMLInputElement>('[data-kalada-row-key="host-a"] input');
	const rootRows = container.querySelectorAll("li");
	expect(rootRows[0].querySelector("fieldset")?.getAttribute("aria-label")).toBe("Item 1");
	act(() => root.render(<KaladaRepeaterRows409 nodeId="rows" label="Entries" rows={[rows[1], rows[0]]} />));
	expect(container.querySelector('[data-kalada-row-key="host-a"] input')).toBe(first);
	expect(container.querySelectorAll("li")[0].getAttribute("data-kalada-row-key")).toBe("host-b");
	act(() => root.render(<KaladaRepeaterRows409 nodeId="rows" label="Entries" rows={[rows[0]]} />));
	expect(container.querySelector('[data-kalada-row-key="host-a"] input')).toBe(first);
	expect(container.querySelector('[data-kalada-row-key="host-b"]')).toBeNull();
});
