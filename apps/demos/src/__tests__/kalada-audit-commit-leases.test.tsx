// @vitest-environment jsdom
import { FormRenderer, type KaladaControlProps } from "@formbar/react-schema";
import { act, useEffect, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { disposeDemoSession } from "../runtime/kalada-demo-install";
import { hookAuditHost } from "./kalada-audit-react-fixture";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("R9 actual host writers cannot mutate during failed SSR or failed client render", async () => {
	const host = hookAuditHost();
	const original = host.snapshot().data;
	const errors = vi.spyOn(console, "error").mockImplementation(() => {});
	const Bad = (props: KaladaControlProps) => {
		props.writers.value?.("render mutation");
		throw new Error("render failure");
	};
	const element = <FormRenderer host={host} widgets={{ "demo16.rich-select": Bad }} />;
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	try {
		expect(renderToString(element)).toContain("data-kalada-extension-error");
		expect(host.snapshot().data).toEqual(original);
		await act(async () => root.render(element));
		expect(host.snapshot().data).toEqual(original);
		expect(container.querySelector("form")).not.toBeNull();
	} finally {
		act(() => root.unmount());
		errors.mockRestore();
		disposeDemoSession(host);
	}
});

it("R9 a committed channel works while update/unmount cleanup channels are revoked", async () => {
	const host = hookAuditHost();
	const channels: KaladaControlProps["writers"]["value"][] = [];
	const cleanups: string[] = [];
	function Editor(props: KaladaControlProps) {
		useEffect(() => {
			if (props.value !== "beta") channels.push(props.writers.value);
			return () => {
				cleanups.push(props.writers.value?.("cleanup mutation").status ?? "missing");
			};
		}, [props.value, props.writers]);
		return <input id={props.a11y?.controlId} value={String(props.value)} readOnly />;
	}
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	try {
		await act(async () => root.render(<FormRenderer host={host} widgets={{ "demo16.rich-select": Editor }} />));
		const old = channels[0];
		await act(async () => {
			const request = old("edited");
			expect(request.status).toBe("queued");
			expect((await request.settled)?.status).toBe("applied");
		});
		expect(host.snapshot().data).toMatchObject({ rows: ["edited", "beta"] });
		expect(old("stale update").status).toBe("uncommitted");
		const current = channels.at(-1);
		await act(async () => {
			const request = current?.("new committed");
			expect((await request?.settled)?.status).toBe("applied");
		});
		act(() => root.unmount());
		expect(channels.at(-1)?.("stale unmount").status).toBe("uncommitted");
		expect(cleanups.every((status) => status === "uncommitted")).toBe(true);
		expect(host.snapshot().data).toMatchObject({ rows: ["new committed", "beta"] });
	} finally {
		disposeDemoSession(host);
	}
});

it("R9 an already committed editor that writes then throws on its own rerender still cannot mutate", async () => {
	const host = hookAuditHost();
	const before = host.snapshot().data;
	const errors = vi.spyOn(console, "error").mockImplementation(() => {});
	function Editor(props: KaladaControlProps) {
		const [crash, setCrash] = useState(false);
		if (crash) {
			props.writers.value?.("failed rerender");
			throw new Error("rerender failure");
		}
		return (
			<button type="button" onClick={() => setCrash(true)}>
				Crash editor
			</button>
		);
	}
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	try {
		await act(async () => root.render(<FormRenderer host={host} widgets={{ "demo16.rich-select": Editor }} />));
		await act(async () => container.querySelector<HTMLButtonElement>("[data-kalada-control] button")?.click());
		expect(host.snapshot().data).toEqual(before);
		expect(container.querySelector("[data-kalada-extension-error]")).not.toBeNull();
	} finally {
		act(() => root.unmount());
		errors.mockRestore();
		disposeDemoSession(host);
	}
});

it("R9 failed layout lifecycle writes are uncommitted and cannot mutate the installed host", async () => {
	const host = hookAuditHost();
	const before = host.snapshot().data;
	const errors = vi.spyOn(console, "error").mockImplementation(() => {});
	function Editor(props: KaladaControlProps) {
		useLayoutEffect(() => {
			expect(props.writers.value?.("layout mutation").status).toBe("uncommitted");
			throw new Error("layout failed");
		}, [props.writers]);
		return <input readOnly value={String(props.value)} />;
	}
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	try {
		await act(async () => root.render(<FormRenderer host={host} widgets={{ "demo16.rich-select": Editor }} />));
		expect(host.snapshot().data).toEqual(before);
		expect(container.querySelector("form")).not.toBeNull();
	} finally {
		act(() => root.unmount());
		errors.mockRestore();
		disposeDemoSession(host);
	}
});
