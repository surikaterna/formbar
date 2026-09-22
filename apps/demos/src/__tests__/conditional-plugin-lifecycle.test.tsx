// @vitest-environment jsdom
import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { arbiterVisibilityDemo } from "../demos/18-arbiter-visibility";
import type { SchemaDemoFixture, SchemaDemoSource } from "../demos/baseline-contracts";
import { SchemaDemoHost } from "../renderers/SchemaDemoHost";

const pluginStats = vi.hoisted(() => ({ created: 0, disposed: 0, active: 0, maxActive: 0, duplicateDisposals: 0 }));
vi.mock("@formbar/arbiter", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@formbar/arbiter")>();
	return {
		...actual,
		createArbiterPlugin: (...args: Parameters<typeof actual.createArbiterPlugin>) => {
			pluginStats.created++;
			pluginStats.active++;
			pluginStats.maxActive = Math.max(pluginStats.maxActive, pluginStats.active);
			const plugin = actual.createArbiterPlugin(...args);
			let disposed = false;
			return {
				...plugin,
				onDispose: () => {
					if (disposed) {
						pluginStats.duplicateDisposals++;
						return;
					}
					disposed = true;
					pluginStats.disposed++;
					pluginStats.active--;
					plugin.onDispose?.();
				},
			};
		},
	};
});

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const alternateRules = [
	{
		name: "alternateUS",
		when: { country: "US" },
		// biome-ignore lint/suspicious/noThenProperty: This is serialized Arbitre rule data.
		then: [
			{
				$set: {
					"$formbar.fieldPolicy.state": { path: "/state", visible: false },
					"$formbar.fieldPolicy.province": { path: "/province", visible: true },
					"$formbar.fieldPolicy.region": { path: "/region", visible: false },
				},
			},
		],
	},
] as const satisfies NonNullable<SchemaDemoSource["arbiterRules"]>;

const alternateFixture: SchemaDemoFixture = {
	...arbiterVisibilityDemo,
	sources: [{ ...arbiterVisibilityDemo.sources[0], arbiterRules: alternateRules }],
};

interface MountedView {
	readonly container: HTMLDivElement;
	readonly root: Root;
}

const mounted: MountedView[] = [];
beforeEach(() =>
	Object.assign(pluginStats, { created: 0, disposed: 0, active: 0, maxActive: 0, duplicateDisposals: 0 }),
);
afterEach(async () => {
	for (const view of mounted.splice(0)) act(() => view.root.unmount());
	await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
	expect(pluginStats.active).toBe(0);
	expect(pluginStats.disposed).toBe(pluginStats.created);
	expect(pluginStats.duplicateDisposals).toBe(0);
	document.body.replaceChildren();
});

function mount(fixture: SchemaDemoFixture, strict = false): MountedView {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const host = <SchemaDemoHost fixture={fixture} />;
	act(() => root.render(strict ? <StrictMode>{host}</StrictMode> : host));
	const view = { container, root };
	mounted.push(view);
	return view;
}

function rerender(view: MountedView, fixture: SchemaDemoFixture): void {
	act(() => view.root.render(<SchemaDemoHost fixture={fixture} />));
}

async function unmount(view: MountedView): Promise<void> {
	act(() => view.root.unmount());
	mounted.splice(mounted.indexOf(view), 1);
	await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

function selectCountry(view: MountedView, label: "US" | "CA"): void {
	const select = [...view.container.querySelectorAll("label")].find((label) => label.textContent === "Country")
		?.nextElementSibling as HTMLSelectElement | undefined;
	if (!select) throw new Error("Missing Country select");
	const option = [...select.options].find((candidate) => candidate.textContent === label);
	if (!option) throw new Error(`Missing ${label} option`);
	act(() => {
		select.value = option.value;
		select.dispatchEvent(new Event("change", { bubbles: true }));
	});
}

function expectPolicy(view: MountedView, visible: "state" | "province"): void {
	expect(view.container.querySelector(`[data-formbar-node="f-${visible}"]`)).not.toBeNull();
	const hidden = visible === "state" ? "province" : "state";
	expect(view.container.querySelector(`[data-formbar-node="f-${hidden}"]`)).toBeNull();
}

function expectCounts(created: number, disposed: number, active: number): void {
	expect(pluginStats).toMatchObject({ created, disposed, active, maxActive: 1, duplicateDisposals: 0 });
}

describe("SchemaDemoHost committed Arbiter lifecycle", () => {
	it("renders truthful deterministic preparation without allocating during render", () => {
		const html = renderToString(<SchemaDemoHost fixture={arbiterVisibilityDemo} />);
		expect(html).toContain("Preparing rule-governed form.");
		expect(html).toContain('aria-busy="true"');
		expect(html).not.toContain("data-formbar-definition");
		expect(pluginStats).toMatchObject({ created: 0, disposed: 0, active: 0 });
	});

	it("keeps one active session through StrictMode and disposes every committed-effect allocation", async () => {
		const view = mount(arbiterVisibilityDemo, true);
		expectCounts(2, 1, 1);
		selectCountry(view, "US");
		expectPolicy(view, "state");
		await unmount(view);
		expectCounts(2, 2, 0);
	});

	it("does not churn identical rule constants on a parent rerender", () => {
		const view = mount(arbiterVisibilityDemo);
		selectCountry(view, "US");
		rerender(view, arbiterVisibilityDemo);
		expectCounts(1, 0, 1);
		expectPolicy(view, "state");
	});

	it("replaces same-key changed rules, clears old policy, and preserves reset cleanup", async () => {
		const view = mount(arbiterVisibilityDemo);
		selectCountry(view, "US");
		expectPolicy(view, "state");
		rerender(view, alternateFixture);
		expectCounts(2, 1, 1);
		expect(view.container.querySelector("[data-formbar-node=regional-details]")).toBeNull();
		selectCountry(view, "US");
		expectPolicy(view, "province");
		await clickReset(view);
		expect(view.container.querySelector("[data-formbar-node=regional-details]")).toBeNull();
		expectCounts(2, 1, 1);
	});

	it("keeps rapid A to B to A replacement at one active session with current policy", () => {
		const view = mount(arbiterVisibilityDemo);
		rerender(view, alternateFixture);
		rerender(view, arbiterVisibilityDemo);
		expectCounts(3, 2, 1);
		selectCountry(view, "US");
		expectPolicy(view, "state");
	});

	it("creates a clean session after a full unmount and remount", async () => {
		const first = mount(arbiterVisibilityDemo);
		await unmount(first);
		expectCounts(1, 1, 0);
		const second = mount(arbiterVisibilityDemo);
		expectCounts(2, 1, 1);
		selectCountry(second, "US");
		expectPolicy(second, "state");
		await unmount(second);
		expectCounts(2, 2, 0);
	});
});

async function clickReset(view: MountedView): Promise<void> {
	const button = [...view.container.querySelectorAll("button")].find((candidate) => candidate.textContent === "Reset");
	if (!button) throw new Error("Missing Reset button");
	await act(async () => {
		button.click();
		await Promise.resolve();
	});
}
