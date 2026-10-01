// @vitest-environment jsdom
import { FormRenderer, type KaladaControlProps } from "@formbar/react-schema";
import { act, useState } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { disposeDemoSession } from "../runtime/kalada-demo-install";
import { hookAuditHost, readonlyCustomAuditHost } from "./kalada-audit-react-fixture";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => document.body.replaceChildren());

function Editor(props: KaladaControlProps) {
	const [local, setLocal] = useState(0);
	return (
		<>
			<input
				id={props.a11y?.controlId}
				aria-labelledby={props.a11y?.labelId}
				aria-describedby={props.a11y?.describedBy}
				aria-invalid={props.a11y?.invalid}
				required={props.required}
				readOnly={props.readOnly}
				disabled={props.disabled}
				data-dirty={props.dirty}
				data-touched={props.touched}
				value={String(props.value ?? props.props.current ?? "")}
				onBlur={() => props.onBlur?.()}
				onChange={(event) => props.writers.value?.(event.currentTarget.value)}
			/>
			<button type="button" aria-label={`increment ${props.value}`} onClick={() => setLocal(local + 1)}>
				{local}
			</button>
		</>
	);
}
const widgets = { "demo16.rich-select": Editor };

it("R1 hook widget boundaries survive actual row reorder and conditional show/hide", async () => {
	const host = hookAuditHost();
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	try {
		act(() => root.render(<FormRenderer host={host} widgets={widgets} />));
		act(() => container.querySelector<HTMLButtonElement>('[aria-label="increment alpha"]')?.click());
		const view = host.snapshot();
		const repeater = view.tree.children?.[1].children?.[0];
		const move = repeater?.rows?.[1].children.find((node) => node.nodeId === "move")?.action;
		const destination = view.rows.find((row) => row.order === 0)?.key;
		await act(async () => {
			expect((await move?.invoke(destination))?.status).toBe("applied");
		});
		expect(container.querySelector('[aria-label="increment alpha"]')?.textContent).toBe("1");
		act(() => {
			expect(
				host
					.snapshot()
					.controls.find((control) => control.nodeId === "show")
					?.writers.value?.(false).status,
			).toBe("applied");
		});
		expect(container.querySelector('[aria-label="increment alpha"]')).toBeNull();
		act(() => {
			expect(
				host
					.snapshot()
					.controls.find((control) => control.nodeId === "show")
					?.writers.value?.(true).status,
			).toBe("applied");
		});
		expect(container.querySelector('[aria-label="increment alpha"]')?.textContent).toBe("0");
	} finally {
		act(() => root.unmount());
		disposeDemoSession(host);
	}
});

it("R1 trusted widget throws are isolated, including server fallback and hydration retry", async () => {
	const host = hookAuditHost();
	const error = vi.spyOn(console, "error").mockImplementation(() => {});
	const Bad = () => {
		throw new Error("trusted widget failed");
	};
	const element = <FormRenderer host={host} widgets={{ "demo16.rich-select": Bad }} />;
	const container = document.createElement("div");
	container.innerHTML = renderToString(element);
	document.body.append(container);
	let root: ReturnType<typeof hydrateRoot> | undefined;
	try {
		expect(container.querySelector("form")).not.toBeNull();
		expect(container.querySelectorAll("[data-kalada-extension-error]")).toHaveLength(2);
		await act(async () => {
			root = hydrateRoot(container, element, { onRecoverableError: () => {} });
		});
		expect(container.querySelector("form")).not.toBeNull();
		expect(container.querySelector('input[type="checkbox"]')).not.toBeNull();
		expect(container.querySelectorAll("[data-kalada-extension-error]")).toHaveLength(2);
	} finally {
		act(() => root?.unmount());
		error.mockRestore();
		disposeDemoSession(host);
	}
});

it("R1/R5 hook editor SSR/hydration keeps accessible labels, descriptions, required flags and actual field issues", async () => {
	const host = hookAuditHost();
	const element = <FormRenderer host={host} widgets={widgets} />;
	const container = document.createElement("div");
	container.innerHTML = renderToString(element);
	document.body.append(container);
	const recoverable: unknown[] = [];
	let root: ReturnType<typeof hydrateRoot> | undefined;
	try {
		await act(async () => {
			root = hydrateRoot(container, element, { onRecoverableError: (error) => recoverable.push(error) });
		});
		expect(recoverable).toEqual([]);
		const input = container.querySelector<HTMLInputElement>("input[required]");
		expect(input?.getAttribute("aria-labelledby")).toBeTruthy();
		expect(document.getElementById(input?.getAttribute("aria-labelledby") ?? "")?.textContent).toBe("Entry");
		expect(document.getElementById(input?.getAttribute("aria-describedby") ?? "")?.textContent).toBe("Entry guidance");
		act(() => {
			expect(
				host
					.snapshot()
					.controls.find((control) => control.value === "alpha")
					?.writers.value?.("x").status,
			).toBe("applied");
		});
		await act(async () => {
			expect((await host.validate()).ok).toBe(false);
		});
		const invalid = container.querySelector<HTMLInputElement>('input[aria-invalid="true"]');
		expect(invalid?.dataset).toMatchObject({ dirty: "true", touched: "true" });
		const ids = invalid?.getAttribute("aria-describedby")?.split(" ") ?? [];
		expect(ids.map((id) => document.getElementById(id)?.textContent).join(" ")).toContain("3 character");
	} finally {
		act(() => root?.unmount());
		disposeDemoSession(host);
	}
});

it("R5 registered custom renderers receive associated read-only labels and schema issue output", async () => {
	const installed = readonlyCustomAuditHost();
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	try {
		act(() => root.render(<FormRenderer host={installed.host} renderers={{ "test.editor": Editor }} />));
		await act(async () => {
			expect((await installed.host.validate()).ok).toBe(false);
		});
		const input = container.querySelector("input");
		expect(input?.readOnly).toBe(true);
		expect(document.getElementById(input?.getAttribute("aria-labelledby") ?? "")?.textContent).toBe("Read-only custom");
		expect(input?.getAttribute("aria-invalid")).toBe("true");
		expect(
			input
				?.getAttribute("aria-describedby")
				?.split(" ")
				.map((id) => document.getElementById(id)?.textContent)
				.join(" "),
		).toContain("Custom guidance");
	} finally {
		act(() => root.unmount());
		installed.dispose();
	}
});
