// @vitest-environment jsdom
import { FormRenderer } from "@formbar/react-schema";
import { act } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";
import { disposeDemoSession, installDemo } from "../runtime/kalada-demo-install";
import { installedAudit, omissionDocument } from "./kalada-audit-fixtures";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("R11 two-form SSR/hydration namespaces have distinct IDs and labels target their own form", async () => {
	const first = installedAudit();
	const second = installedAudit();
	const element = (
		<>
			<FormRenderer host={first} />
			<FormRenderer host={second} />
		</>
	);
	const container = document.createElement("div");
	container.innerHTML = renderToString(element);
	document.body.append(container);
	const recoverable: unknown[] = [];
	let root: ReturnType<typeof hydrateRoot> | undefined;
	try {
		const ids = [...container.querySelectorAll("[id]")].map((node) => node.id);
		expect(new Set(ids).size).toBe(ids.length);
		await act(async () => {
			root = hydrateRoot(container, element, { onRecoverableError: (error) => recoverable.push(error) });
		});
		expect(recoverable).toEqual([]);
		for (const label of container.querySelectorAll<HTMLLabelElement>("label[for]")) {
			expect(label.control).not.toBeNull();
			expect(label.closest("form")?.contains(label.control)).toBe(true);
		}
		expect([...container.querySelectorAll("[id]")].map((node) => node.id)).toEqual(ids);
	} finally {
		act(() => root?.unmount());
		disposeDemoSession(first);
		disposeDemoSession(second);
		container.remove();
	}
});

it("R12 denied submit links and focuses the first supported CURRENT invalid native control", async () => {
	const host = installedAudit();
	host.snapshot().controls[0].writers.value?.("x");
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	try {
		await act(async () => root.render(<FormRenderer host={host} />));
		await act(async () => container.querySelector<HTMLButtonElement>('button[type="submit"]')?.click());
		const input = container.querySelector("input");
		expect(document.activeElement).toBe(input);
		const link = container.querySelector<HTMLAnchorElement>("[data-kalada-issue-summary] a");
		expect(link?.getAttribute("href")).toBe(`#${input?.id}`);
		expect(link?.textContent).toContain("Name");
		expect(input?.getAttribute("aria-invalid")).toBe("true");
		const other = container.querySelectorAll<HTMLInputElement>("input")[1];
		act(() => other.focus());
		expect(document.activeElement).toBe(other);
		await act(async () => host.snapshot().controls[0].onBlur?.());
		expect(document.activeElement).toBe(other);
		await act(async () => container.querySelector<HTMLButtonElement>('button[type="submit"]')?.click());
		expect(document.activeElement).toBe(input);
		act(() => container.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus());
		act(() => link?.click());
		expect(document.activeElement).toBe(input);
	} finally {
		act(() => root.unmount());
		disposeDemoSession(host);
		container.remove();
	}
});

it("R12 hidden invalid controls fall back to the current summary without focusing a stale element", async () => {
	const host = installDemo(omissionDocument(true));
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	try {
		await act(async () => root.render(<FormRenderer host={host} />));
		await act(async () => container.querySelector<HTMLButtonElement>('button[type="submit"]')?.click());
		expect(document.activeElement).toBe(container.querySelector("[data-kalada-issue-summary]"));
		expect(container.querySelector('[data-kalada-control="hidden"]')).toBeNull();
		act(() => root.unmount());
		expect(document.activeElement).toBe(document.body);
	} finally {
		disposeDemoSession(host);
		container.remove();
	}
});
