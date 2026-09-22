// @vitest-environment jsdom
import type { FormDefinition } from "@formbar/declarative";
import { act } from "react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { FormRenderer } from "../index.js";
import type { RendererContext, RendererExtensions, WidgetProps } from "../index.js";
import { binding, literal, mountForm } from "./renderer-test-utils.js";

function Card(props: RendererContext) {
	return (
		<section data-card={String(props.props.tone)} data-instance={props.instanceKey}>
			{props.children}
		</section>
	);
}

function Input(props: WidgetProps) {
	return <input id={props.a11y.controlId} value={String(props.value ?? "")} readOnly />;
}

describe("trusted custom-node registry", () => {
	it("passes identity, policy, literal JSON props, and pre-rendered direct children only", () => {
		let received: RendererContext | undefined;
		const definition: FormDefinition = {
			version: 1,
			id: "custom-card",
			root: {
				type: "custom",
				id: "card",
				renderer: "demo.card",
				props: { tone: literal("info") },
				children: [{ type: "field", id: "name", binding: binding("name"), widget: "demo.input" }],
			},
		};
		const view = mountForm({
			schema: { type: "object", properties: { name: { type: "string" } } },
			definition,
			data: { name: "Ada" },
			extensions: {
				nodes: [
					{
						id: "demo.card",
						component: (props) => {
							received = props;
							return <Card {...props} />;
						},
					},
				],
				widgets: [{ id: "demo.input", component: Input }],
			},
		});
		expect(view.container.querySelector("section")?.getAttribute("data-card")).toBe("info");
		expect(view.container.querySelector("input")?.value).toBe("Ada");
		expect(received).toMatchObject({
			nodeId: "card",
			renderer: "demo.card",
			props: { tone: "info" },
			policy: { visible: true, disabled: false, readOnly: false },
		});
		expect(received).not.toHaveProperty("form");
		expect(received).not.toHaveProperty("runtime");
		expect(received).not.toHaveProperty("node");
		view.unmount();
	});

	it("fails missing, invalid, validator, and component errors closed", () => {
		const Throw = (_props: { readonly children?: ReactNode }) => {
			throw new Error("private failure");
		};
		const definition: FormDefinition = {
			version: 1,
			id: "custom-failures",
			root: {
				type: "group",
				id: "root",
				children: [
					{ type: "custom", id: "missing", renderer: "demo.missing" },
					{
						type: "custom",
						id: "dynamic",
						renderer: "demo.card",
						props: {
							tone: {
								mode: "read",
								expression: { kind: "ref", ref: { namespace: "data", segments: ["name"] } },
							},
						},
					},
					{ type: "custom", id: "validator", renderer: "demo.validator" },
					{ type: "custom", id: "throw", renderer: "demo.throw" },
				],
			},
		};
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const view = mountForm({
			schema: { type: "object", properties: { name: { type: "string" } } },
			definition,
			data: { name: "Ada" },
			extensions: {
				nodes: [
					{ id: "demo.card", component: Card },
					{
						id: "demo.validator",
						component: Card,
						validateProps: () => {
							throw new Error("secret");
						},
					},
					{ id: "demo.throw", component: Throw },
				],
			},
		});
		const codes = [...view.container.querySelectorAll("[data-formbar-diagnostic]")].map((node) =>
			node.getAttribute("data-formbar-diagnostic"),
		);
		expect(codes).toEqual([
			"missing-extension",
			"invalid-extension-props",
			"extension-validator-failed",
			"extension-render-failed",
		]);
		expect(view.container.textContent).not.toContain("private failure");
		view.unmount();
		consoleError.mockRestore();
	});

	it("isolates each direct child failure without exposing failed custom-node children", () => {
		const ThrowWidget = () => {
			throw new Error("child");
		};
		const ThrowNode = () => {
			throw new Error("node");
		};
		const children = [
			{ type: "field" as const, id: "broken", binding: binding("broken"), widget: "demo.throw" },
			{ type: "field" as const, id: "safe", binding: binding("safe"), widget: "demo.input" },
		];
		const definition: FormDefinition = {
			version: 1,
			id: "isolation",
			root: {
				type: "group",
				id: "root",
				children: [
					{ type: "custom", id: "card", renderer: "demo.card", children },
					{
						type: "custom",
						id: "failed-card",
						renderer: "demo.throw-node",
						children: [{ type: "field", id: "failed-safe", binding: binding("safe"), widget: "demo.input" }],
					},
				],
			},
		};
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const view = mountForm({
			schema: {
				type: "object",
				properties: { broken: { type: "string" }, safe: { type: "string" } },
			},
			definition,
			data: { broken: "no", safe: "yes" },
			extensions: {
				nodes: [
					{ id: "demo.card", component: Card },
					{ id: "demo.throw-node", component: ThrowNode },
				],
				widgets: [
					{ id: "demo.throw", component: ThrowWidget },
					{ id: "demo.input", component: Input },
				],
			},
		});
		expect(view.container.querySelector('[data-formbar-diagnostic="extension-child-failed"]')).not.toBeNull();
		expect(view.container.querySelector('section input[value="yes"]')).not.toBeNull();
		const failedNode = view.container.querySelector(
			'[data-formbar-node="failed-card"] [data-formbar-diagnostic="extension-render-failed"]',
		);
		expect(failedNode).not.toBeNull();
		expect(failedNode?.querySelector("input")).toBeNull();
		view.unmount();
		consoleError.mockRestore();
	});

	it("retries failed custom nodes for normalized props, renderer IDs, and implementation changes", () => {
		let attempts = 0;
		const Throw = () => {
			attempts += 1;
			throw new Error("node");
		};
		const definition = (renderer: string, tone: string): FormDefinition => ({
			version: 1,
			id: "custom-recovery",
			root: { type: "custom", id: "card", renderer, props: { tone: literal(tone) } },
		});
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const view = mountForm({
			schema: { type: "object" },
			definition: definition("demo.a", "one"),
			data: {},
			extensions: { nodes: [{ id: "demo.a", component: Throw }] },
		});
		const render = (next: FormDefinition, nodes: NonNullable<RendererExtensions["nodes"]>) =>
			act(() =>
				view.root.render(<FormRenderer {...view.prepared} form={view.form} definition={next} extensions={{ nodes }} />),
			);
		const initialAttempts = attempts;
		expect(initialAttempts).toBeGreaterThan(0);
		render(definition("demo.a", "one"), [{ id: "demo.a", component: Throw }]);
		expect(attempts).toBe(initialAttempts);
		render(definition("demo.a", "two"), [{ id: "demo.a", component: Throw }]);
		const afterProps = attempts;
		expect(afterProps).toBeGreaterThan(initialAttempts);
		render(definition("demo.b", "two"), [{ id: "demo.b", component: Throw }]);
		expect(attempts).toBeGreaterThan(afterProps);
		render(definition("demo.b", "two"), [{ id: "demo.b", component: Card }]);
		expect(view.container.querySelector("section")?.getAttribute("data-card")).toBe("two");
		view.unmount();
		consoleError.mockRestore();
	});
});
