// @vitest-environment jsdom
import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { arbiterVisibilityDemo } from "../demos/18-arbiter-visibility";
import { SchemaDemoHost } from "../renderers/SchemaDemoHost";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mounted: { root: ReturnType<typeof createRoot>; container: HTMLDivElement }[] = [];
afterEach(() => {
	for (const { root, container } of mounted.splice(0)) {
		act(() => root.unmount());
		container.remove();
	}
});

function mount() {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	mounted.push({ root, container });
	act(() =>
		root.render(
			<StrictMode>
				<SchemaDemoHost fixture={arbiterVisibilityDemo} />
			</StrictMode>,
		),
	);
	return { container, root };
}

function select(container: HTMLElement, text: string) {
	const country = [...container.querySelectorAll("label")].find((node) => node.textContent === "Country")?.control;
	if (!(country instanceof HTMLSelectElement)) throw new Error("Missing Country select");
	const option = [...country.options].find((node) => node.textContent === text);
	if (!option) throw new Error(`Missing ${text} option`);
	act(() => {
		country.value = option.value;
		country.dispatchEvent(new Event("change", { bubbles: true }));
	});
}

describe("committed rule-governed host lifecycle", () => {
	it("does not allocate an interactive strategy while server rendering", () => {
		const html = renderToString(<SchemaDemoHost fixture={arbiterVisibilityDemo} />);
		expect(html).not.toContain("data-kalada-v1");
		expect(html).toContain("Preparing rule-governed form");
	});

	it("replaces visible regional policy on edit and clears it on reset under StrictMode", () => {
		const { container } = mount();
		select(container, "US");
		expect(container.querySelector('[data-kalada-control="f-state"]')).not.toBeNull();
		select(container, "CA");
		expect(container.querySelector('[data-kalada-control="f-state"]')).toBeNull();
		expect(container.querySelector('[data-kalada-control="f-province"]')).not.toBeNull();
		act(() => container.querySelector<HTMLButtonElement>('button[type="button"]')?.click());
		expect(container.querySelector('[data-kalada-control="f-province"]')).toBeNull();
	});

	it("starts a new isolated regional session after unmount", () => {
		const first = mount();
		select(first.container, "US");
		act(() => first.root.unmount());
		mounted.splice(
			mounted.findIndex((entry) => entry.root === first.root),
			1,
		);
		const second = mount();
		expect(second.container.querySelector('[data-kalada-control="f-state"]')).toBeNull();
		select(second.container, "CA");
		expect(second.container.querySelector('[data-kalada-control="f-province"]')).not.toBeNull();
	});
});
