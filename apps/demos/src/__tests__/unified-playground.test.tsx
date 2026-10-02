// @vitest-environment jsdom
import type { KaladaV1Host } from "@formbar/declarative";
import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "../App";
import { catalogue, catalogueIds } from "../catalogue";
import { getPlaygroundCompatibility } from "../playground/examples";
import { readRoute, resolveRoute } from "../playground/route";

const hosts = vi.hoisted(() => [] as KaladaV1Host[]);
vi.mock("../renderers/use-demo-installation", async (original) => {
	const module = await original<typeof import("../renderers/use-demo-installation")>();
	return {
		...module,
		useDemoInstallation: (...args: Parameters<typeof module.useDemoInstallation>) => {
			const installed = module.useDemoInstallation(...args);
			if (installed.host && !hosts.includes(installed.host)) hosts.push(installed.host);
			return installed;
		},
	};
});

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
afterEach(async () => {
	await act(async () => root?.unmount());
	container?.remove();
	hosts.length = 0;
	window.localStorage.clear();
});

async function mount(url: string) {
	window.history.replaceState(null, "", url);
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	await act(async () =>
		root?.render(
			<StrictMode>
				<App />
			</StrictMode>,
		),
	);
}

async function click(text: string) {
	const button = [...container.querySelectorAll("button")].find((item) => item.textContent?.includes(text));
	if (!button) throw new Error(`Missing ${text}`);
	await act(async () => button.click());
}

async function select(id: string) {
	const selector = container.querySelector("header select");
	if (!(selector instanceof HTMLSelectElement)) throw new Error("Missing common selector");
	await act(async () => {
		selector.value = id;
		selector.dispatchEvent(new Event("change", { bubbles: true }));
	});
}

it("has unique discriminated registrations and canonical, query-independent route authority", () => {
	expect(new Set(catalogueIds).size).toBe(catalogue.length);
	const compatibility = getPlaygroundCompatibility();
	for (const id of ["quote", "line-items"]) {
		const url = new URL(`https://example.com/formbar/?mode=fsx&demo=${id}&preset=evil&profile=evil#docs`);
		const requested = readRoute(url, catalogueIds, compatibility);
		const result = resolveRoute(url, requested, catalogueIds, compatibility);
		expect(result.route).toEqual({ mode: "playground", demoId: `fsx-${id}` });
		expect(result.url.pathname).toBe("/formbar/");
		expect(result.url.hash).toBe("#docs");
		expect(result.url.searchParams.get("preset")).toBeNull();
		expect(result.url.searchParams.get("profile")).toBe("evil");
	}
	expect(
		readRoute(new URL("https://example.com/?mode=playground&demo=fsx-evil"), catalogueIds, compatibility).demoId,
	).toBe("basic-contact");
});

it("opens sidebar FSX demos, returns to the selected demo, and switches both runtimes with fresh defaults", async () => {
	await mount("/formbar/?mode=demo&demo=basic-contact");
	await click("Writable line items");
	expect(container.querySelector("aside [aria-current=page]")?.textContent).toContain("Writable line items");
	expect(container.textContent).toContain("Source and initial JSON");
	expect(container.querySelector("form")).not.toBeNull();
	await click("Open in Playground");
	expect(window.location.search).toBe("?mode=playground&demo=fsx-line-items");
	const lineHost = hosts.at(-1) as KaladaV1Host;
	const lineAction = lineHost
		.snapshot()
		.tree.children?.[0].rows?.[0].children.find(({ action }) => action?.name === "array.remove")?.action;
	expect(lineAction).toBeDefined();
	await select("fsx-quote");
	expect((await lineAction?.invoke())?.status).not.toBe("applied");
	const old = hosts.at(-1) as KaladaV1Host;
	const writer = old.snapshot().controls.find(({ nodeId }) => nodeId === "quantity")?.writers.value;
	await act(async () => {
		expect(writer?.(null).status).toBe("applied");
	});
	const stale = old.snapshot().controls.find(({ nodeId }) => nodeId === "quantity")?.writers.value;
	await select("multi-schema-sources");
	expect(container.textContent).toContain("Fixed trusted runtime context");
	expect(container.querySelector("#source-schema")).not.toBeNull();
	expect(stale?.(999).status).not.toBe("applied");
	expect((await old.submit()).status).not.toBe("submitted");
	const jsonHost = hosts.at(-1) as KaladaV1Host;
	const before = jsonHost.snapshot().data;
	const jsonWriter = jsonHost.snapshot().controls.find(({ writers }) => writers.value)?.writers.value;
	expect(jsonWriter).toBeDefined();
	expect(stale?.(998).status).not.toBe("applied");
	expect(jsonHost.snapshot().data).toEqual(before);
	await select("fsx-quote");
	expect(jsonWriter?.("stale JSON").status).not.toBe("applied");
	expect((await jsonHost.submit()).status).not.toBe("submitted");
	expect(hosts.at(-1)?.snapshot().data).toMatchObject({ quantity: 2 });
	expect(jsonHost.currentRevision()).toBeUndefined();
	expect(() => jsonHost.snapshot()).toThrow("STALE_CAPTURE");
	await click("← Demo");
	expect(window.location.search).toBe("?mode=demo&demo=fsx-quote");
	expect(container.querySelector("aside [aria-current=page]")?.textContent).toContain("Reactive quote");
});

it("canonicalizes legacy URLs and popstate across FSX, JSON presets and demo modes", async () => {
	await mount("/formbar/?mode=fsx&demo=quote&preset=evil");
	expect(window.location.search).toBe("?mode=playground&demo=fsx-quote");
	for (const [query, editor] of [
		["mode=playground&demo=custom-renderers&preset=authored-overrides", "#source-schema"],
		["mode=fsx&demo=line-items", '[aria-label="FSX sources"] textarea'],
		["mode=demo&demo=fsx-line-items", '[aria-current="page"]'],
	]) {
		await act(async () => {
			window.history.pushState(null, "", `/formbar/?${query}`);
			window.dispatchEvent(new PopStateEvent("popstate"));
		});
		expect(container.querySelector(editor)).not.toBeNull();
	}
});
