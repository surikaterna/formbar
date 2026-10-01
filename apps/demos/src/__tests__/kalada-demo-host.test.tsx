// @vitest-environment jsdom
import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { basicContactDemo } from "../demos/01-basic-contact";
import { arbiterCalculatedDemo } from "../demos/19-arbiter-calculated";
import { literal } from "../demos/kalada-fixture-programs";
import { SchemaDemoHost } from "../renderers/SchemaDemoHost";
import { SchemaFormRuntime } from "../renderers/SchemaFormRuntime";
import { disposeDemoSession, installDemo, installDemoSession } from "../runtime/kalada-demo-install";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const views: { root: ReturnType<typeof createRoot>; container: HTMLDivElement }[] = [];
afterEach(() => {
	for (const { root, container } of views.splice(0)) {
		act(() => root.unmount());
		container.remove();
	}
});

function mount(onSubmit = vi.fn(), strict = false) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	views.push({ root, container });
	const host = <SchemaDemoHost fixture={basicContactDemo} onSubmit={onSubmit} />;
	act(() => root.render(strict ? <StrictMode>{host}</StrictMode> : host));
	return { container, onSubmit };
}

function edit(container: HTMLElement, label: string, value: string) {
	const input = [...container.querySelectorAll("label")].find((node) => node.textContent === label)?.control;
	if (!(input instanceof HTMLInputElement)) throw new Error(`Missing ${label}`);
	act(() => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
		input.dispatchEvent(new Event("change", { bubbles: true }));
	});
	return input;
}

describe("app-installed Kalada V1 host", () => {
	it("renders an attested form on the server without accessing the browser DOM", () => {
		const html = renderToString(<SchemaDemoHost fixture={basicContactDemo} />);
		expect(html).toContain("data-kalada-v1");
		expect(html).not.toContain("Trusted runtime profile rejected");
	});
	it("rotates attested policy and revokes retired writers while preserving the draft", () => {
		const source = basicContactDemo.sources[0];
		const document = { version: 2 as const, schema: source.schema, definition: null, initialData: {} };
		const old = installDemo(document);
		const first = old.snapshot();
		const name = first.controls.find((control) => control.path === "root.children[0]");
		expect(name?.nodeId).toBe((old.definition as { root: { children: { id: string }[] } }).root.children[0]?.id);
		expect(name?.key).toBeTruthy();
		expect(first.rows).toEqual([]);
		const writer = name?.writers.value;
		expect(writer, "generated name writer").toBeDefined();
		expect(writer?.("Ada")).toEqual({ status: "applied" });
		const priorRevision = old.currentRevision();
		disposeDemoSession(old);
		const current = installDemoSession(document, undefined, ["formbar.standard.v1"], old);
		expect(current.currentRevision()).not.toBe(priorRevision);
		expect(writer?.("Retired").status).not.toBe("applied");
		expect(current.snapshot().data).toMatchObject({ name: "Ada" });
		const after = current.snapshot();
		expect(after.controls.find((control) => control.path === name?.path)?.key).toBe(name?.key);
		expect(after.rows).toEqual(first.rows);
		const next = after.controls.find((control) => control.path === name?.path)?.writers.value;
		expect(next?.("Grace")).toEqual({ status: "applied" });
		expect(current.snapshot().data).toMatchObject({ name: "Grace" });
		disposeDemoSession(current);
	});

	it("keeps strategy-owned row identity across profile reinstallation", () => {
		const document = {
			version: 2 as const,
			schema: { type: "object", properties: { rows: { type: "array", items: { type: "string" } } } },
			definition: null,
			initialData: { rows: ["first"] },
		};
		const old = installDemo(document);
		const before = old.snapshot();
		expect(before.rows).toHaveLength(1);
		const retired = before.controls.find((control) => control.path.includes("children[0]"))?.writers.value;
		disposeDemoSession(old);
		const next = installDemoSession(document, undefined, ["formbar.standard.v1"], old);
		expect(next.snapshot().rows.map((row) => row.key)).toEqual(before.rows.map((row) => row.key));
		const draft = next.snapshot().data;
		expect(retired?.("denied").status).not.toBe("applied");
		expect(next.snapshot().data).toEqual(draft);
		disposeDemoSession(next);
	});
	it("writes a generated primitive Field.value as a whole scoped row without replacing its identity", () => {
		const document = {
			version: 2 as const,
			schema: { type: "object", properties: { rows: { type: "array", items: { type: "string" } } } },
			definition: null,
			initialData: { rows: ["first", "second"] },
		};
		const host = installDemo(document);
		const before = host.snapshot();
		const control = before.controls.find((item) => item.value === "first");
		expect(control?.writers.value?.("edited")).toEqual({ status: "applied" });
		const after = host.snapshot();
		expect(after.data).toEqual({ rows: ["edited", "second"] });
		expect(after.rows.map((row) => row.key)).toEqual(before.rows.map((row) => row.key));
		const revision = host.currentRevision();
		expect(control?.writers.value?.("stale").status).not.toBe("applied");
		const fresh = after.controls.find((item) => item.value === "edited");
		expect(fresh?.writers.value?.(42).status).not.toBe("applied");
		expect(host.currentRevision()).toBe(revision);
		expect(host.snapshot().data).toEqual(after.data);
		disposeDemoSession(host);
	});

	it("rejects an untrusted profile instead of silently granting its widgets", () => {
		const source = basicContactDemo.sources[0];
		expect(() =>
			installDemo({ version: 2, schema: source.schema, definition: null, initialData: {} }, undefined, [
				"formbar.standard.v1",
				"untrusted.widget.v1",
			]),
		).toThrow(/Trusted runtime profile rejected/);
	});

	it("recomputes authored outputs from the current draft and revokes UI authority on profile change", () => {
		const source = arbiterCalculatedDemo.sources[0];
		const document = {
			version: 2 as const,
			schema: source.schema,
			definition: source.definition,
			initialData: source.initialData,
		};
		const old = installDemo(
			document,
			undefined,
			["formbar.standard.v1", "formbar.arbiter.v1", "demo19.numeric-presentation.v1"],
			source.initialUiState,
			source.arbiterRules,
		);
		const before = old.snapshot();
		expect(before.outputs.find((output) => output.nodeId === "subtotal-output")?.value).toBe(25);
		expect(before.outputs.some((output) => output.nodeId === "small-total")).toBe(true);
		expect(before.outputs.some((output) => output.nodeId === "bulk-total")).toBe(false);
		const writer = before.controls.find((control) => control.nodeId === "f-quantity")?.writers.value;
		expect(writer?.(10)).toEqual({ status: "applied" });
		const calculated = old.snapshot();
		expect(calculated.outputs.find((output) => output.nodeId === "subtotal-output")?.value).toBe(250);
		expect(calculated.outputs.some((output) => output.nodeId === "bulk-total")).toBe(true);
		expect(calculated.outputs.some((output) => output.nodeId === "small-total")).toBe(false);
		expect(calculated.data).toEqual({ quantity: 10, unitPrice: 25 });
		disposeDemoSession(old);
		const next = installDemoSession(
			document,
			undefined,
			["formbar.standard.v1", "formbar.arbiter.v1", "demo19.numeric-presentation.v1"],
			old,
			source.initialUiState,
			source.arbiterRules,
		);
		expect(writer?.(2).status).not.toBe("applied");
		expect(next.snapshot().data).toMatchObject({ quantity: 10 });
		expect(next.snapshot().outputs.find((output) => output.nodeId === "subtotal-output")?.value).toBe(250);
		disposeDemoSession(next);
	});

	it("uses schema authority for writable generated fields and validated submission", async () => {
		const { container, onSubmit } = mount(vi.fn(), true);
		expect(container.querySelector("form[data-kalada-v1]"), container.textContent ?? "").not.toBeNull();
		expect(container.querySelector('[role="alert"]')).toBeNull();
		await act(async () => {
			container.querySelector<HTMLButtonElement>('form button[type="submit"]')?.click();
			await Promise.resolve();
		});
		expect(onSubmit).not.toHaveBeenCalled();
		expect(container.querySelector("[data-kalada-issue-summary]")?.textContent).toContain("email");
		edit(container, "Full Name", "Ada");
		edit(container, "Email", "ada@example.com");
		await act(async () => {
			container.querySelector<HTMLButtonElement>('form button[type="submit"]')?.click();
			await Promise.resolve();
		});
		expect(onSubmit).toHaveBeenCalledWith({ name: "Ada", email: "ada@example.com" });
		expect(Object.isFrozen(onSubmit.mock.calls[0]?.[0])).toBe(true);
		act(() => container.querySelector<HTMLButtonElement>('button[type="button"]')?.click());
		expect((container.querySelector("input") as HTMLInputElement).value).toBe("");
		expect(container.querySelector("[data-kalada-issue-summary]")).toBeNull();
	});

	it("rejects untrusted, unattested fields before mounting any writable control", () => {
		const source = basicContactDemo.sources[0];
		expect(() =>
			installDemo({
				version: 2,
				schema: source.schema,
				initialData: {},
				definition: {
					version: 1,
					id: "unattested",
					root: {
						id: "root",
						type: "group",
						children: [
							{ id: "evil", type: "field", widget: "text", binding: { namespace: "data", segments: ["secret"] } },
						],
					},
				},
			}),
		).toThrow(/UNATTESTED_PATH/);
	});

	it("FINAL-validates an omitted outgoing payload rather than granting the validated draft", async () => {
		const submitted = vi.fn();
		const host = installDemo(
			{
				version: 2,
				schema: { type: "object", required: ["name"], properties: { name: { type: "string" } } },
				initialData: { name: "Ada" },
				definition: {
					version: 1,
					id: "omission",
					submission: { hiddenValues: "omit-inactive" },
					root: {
						id: "root",
						type: "group",
						children: [
							{
								id: "name",
								type: "field",
								widget: "text",
								binding: { namespace: "data", segments: ["name"] },
								visible: literal(false),
							},
						],
					},
				},
			},
			submitted,
		);
		try {
			expect(host.snapshot().controls).toHaveLength(0);
			expect((await host.submit()).status).toBe("denied");
			expect(submitted).not.toHaveBeenCalled();
			expect(host.snapshot().data).toEqual({ name: "Ada" });
		} finally {
			disposeDemoSession(host);
		}
	});

	it("edits a nested schema-attested field and restores its initialized value on reset", async () => {
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		views.push({ root, container });
		const onSubmit = vi.fn();
		act(() =>
			root.render(
				<SchemaFormRuntime
					document={{
						version: 2,
						schema: {
							type: "object",
							properties: {
								profile: {
									type: "object",
									additionalProperties: false,
									properties: { name: { type: "string", title: "Name" } },
								},
							},
						},
						definition: null,
						initialData: { profile: { name: "Original" } },
					}}
					onSubmit={onSubmit}
				/>,
			),
		);
		const input = [...container.querySelectorAll("label")].find((label) => label.textContent === "Name")?.control;
		expect(input, container.textContent ?? "").toBeInstanceOf(HTMLInputElement);
		expect((input as HTMLInputElement).value).toBe("Original");
		edit(container, "Name", "Ada");
		await act(async () => {
			container.querySelector<HTMLButtonElement>('form button[type="submit"]')?.click();
			await Promise.resolve();
		});
		expect(onSubmit).toHaveBeenCalledWith({ profile: { name: "Ada" } });
		act(() => container.querySelector<HTMLButtonElement>('button[type="button"]')?.click());
		expect((input as HTMLInputElement).value).toBe("Original");
	});
});
