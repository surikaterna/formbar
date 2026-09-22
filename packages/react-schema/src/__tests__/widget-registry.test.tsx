// @vitest-environment jsdom
import type { FormDefinition } from "@formbar/declarative";
import { StrictMode, act, useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { FormRenderer } from "../index.js";
import type { RendererExtensions, WidgetProps, WidgetRegistration } from "../index.js";
import { binding, literal, mountForm } from "./renderer-test-utils.js";

function ReferenceWidget(props: WidgetProps) {
	return (
		<button
			id={props.a11y.controlId}
			type="button"
			aria-labelledby={props.a11y.labelId}
			aria-describedby={props.a11y.describedBy}
			aria-invalid={props.a11y.invalid || undefined}
			disabled={props.policy.disabled}
			onClick={() => props.onChange(4)}
			onBlur={props.onBlur}
		>
			{props.widget}
		</button>
	);
}

const rating: WidgetRegistration = { id: "demo.rating", component: ReferenceWidget };

describe("trusted widget registry", () => {
	it("selects the same host component from generated and authored IDs while retaining schema evidence", () => {
		const received: WidgetProps[] = [];
		const extensions = {
			widgets: [
				{
					...rating,
					component: (props: WidgetProps) => {
						received.push(props);
						return <ReferenceWidget {...props} />;
					},
				},
			],
		};
		const schema = {
			type: "object",
			properties: {
				quality: {
					type: "integer",
					title: "Quality",
					description: "One to five",
					minimum: 1,
					maximum: 5,
					multipleOf: 1,
					"x-formbar": { widget: "demo.rating", props: { icon: "star" } },
				},
			},
		};
		const generated = mountForm({ schema, data: { quality: 2 }, extensions });
		expect(received.at(-1)).toMatchObject({
			widget: "demo.rating",
			value: 2,
			props: { icon: "star", description: "One to five" },
			constraints: { primitive: "integer", minimum: 1, maximum: 5, multipleOf: 1 },
			metadata: { label: "Quality", description: "One to five" },
		});
		expect(Object.isFrozen(received.at(-1)?.props)).toBe(true);
		generated.unmount();

		const authored: FormDefinition = {
			version: 1,
			id: "authored",
			root: {
				type: "field",
				id: "quality",
				binding: binding("quality"),
				widget: "demo.rating",
				props: { icon: literal("heart") },
			},
		};
		let schemaWidgetCalls = 0;
		const authoredSchema = {
			...schema,
			properties: {
				quality: {
					...schema.properties.quality,
					"x-formbar": { widget: "schema.other" },
				},
			},
		};
		const explicit = mountForm({
			schema: authoredSchema,
			definition: authored,
			data: { quality: 3 },
			extensions: {
				widgets: [
					...extensions.widgets,
					{
						id: "schema.other",
						component: (props: WidgetProps) => {
							schemaWidgetCalls += 1;
							return <ReferenceWidget {...props} />;
						},
					},
				],
			},
		});
		expect(received.at(-1)).toMatchObject({
			widget: "demo.rating",
			value: 3,
			props: { icon: "heart" },
			constraints: { primitive: "integer", minimum: 1, maximum: 5, multipleOf: 1 },
			metadata: { description: "One to five" },
		});
		expect(schemaWidgetCalls).toBe(0);
		expect(explicit.container.querySelector("button")?.getAttribute("aria-labelledby")).toBeTruthy();
		explicit.unmount();
	});

	it("passes scalar and array-item enum options", () => {
		const received: WidgetProps[] = [];
		const extensions = {
			widgets: [
				{
					id: "demo.checkbox-group",
					component: (props: WidgetProps) => {
						received.push(props);
						return <ReferenceWidget {...props} />;
					},
				},
			],
		};
		const view = mountForm({
			schema: {
				type: "object",
				properties: {
					colors: {
						type: "array",
						items: { type: "string", enum: ["red", "blue"] },
						"x-formbar": { widget: "demo.checkbox-group" },
					},
				},
			},
			data: { colors: ["red"] },
			extensions,
		});
		expect(received.at(-1)?.options).toEqual([
			{ value: "red", label: "red" },
			{ value: "blue", label: "blue" },
		]);
		view.unmount();
	});

	it("blocks policy writes and marks only the field touched on blur", () => {
		let received: WidgetProps | undefined;
		const definition: FormDefinition = {
			version: 1,
			id: "policy",
			root: {
				type: "field",
				id: "quality",
				binding: binding("quality"),
				widget: "demo.rating",
				disabled: { kind: "literal", value: true },
			},
		};
		const view = mountForm({
			schema: { type: "object", properties: { quality: { type: "integer" } } },
			definition,
			data: { quality: 2 },
			extensions: {
				widgets: [
					{
						...rating,
						component: (props) => {
							received = props;
							return <ReferenceWidget {...props} />;
						},
					},
				],
			},
		});
		act(() => {
			received?.onChange(5);
			received?.onBlur();
		});
		expect(view.form.getState().data).toEqual({ quality: 2 });
		expect(view.form.fieldDynamic("/quality").isTouched()).toBe(true);
		view.unmount();
	});

	it("links and focuses a successful custom control from the error summary", async () => {
		const definition: FormDefinition = {
			version: 1,
			id: "custom-error",
			root: { type: "field", id: "quality", binding: binding("quality"), widget: "demo.rating" },
		};
		const view = mountForm({
			schema: { type: "object", properties: { quality: { type: "integer" } } },
			definition,
			data: { quality: 2 },
			extensions: { widgets: [rating] },
			formOptions: {
				validators: [
					() => [
						{
							code: "quality",
							message: "Choose a quality",
							severity: "error" as const,
							path: { namespace: "data" as const, segments: ["quality"] },
							source: { origin: "function-validator" as const, validatorId: "quality" },
						},
					],
				],
			},
		});
		await act(async () => {
			view.container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
			await Promise.resolve();
		});
		const control = view.container.querySelector("button") as HTMLButtonElement;
		expect(view.container.querySelector("[data-formbar-error-summary] a")?.getAttribute("href")).toBe(`#${control.id}`);
		expect(document.activeElement).toBe(control);
		expect(control.getAttribute("aria-invalid")).toBe("true");
		view.unmount();
	});

	it("omits a throwing custom widget from error-summary links", async () => {
		const Throw = () => {
			throw new Error("widget");
		};
		const definition: FormDefinition = {
			version: 1,
			id: "failed-error",
			root: { type: "field", id: "quality", binding: binding("quality"), widget: "demo.throw" },
		};
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const view = mountForm({
			schema: { type: "object", properties: { quality: { type: "integer" } } },
			definition,
			data: { quality: 2 },
			extensions: { widgets: [{ id: "demo.throw", component: Throw }] },
			formOptions: {
				validators: [
					() => [
						{
							code: "quality",
							message: "Choose a quality",
							severity: "error" as const,
							path: { namespace: "data" as const, segments: ["quality"] },
							source: { origin: "function-validator" as const, validatorId: "quality" },
						},
					],
				],
			},
		});
		await act(async () => {
			view.container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
			await Promise.resolve();
		});
		expect(view.container.querySelector("[data-formbar-error-summary] a")).toBeNull();
		expect(document.activeElement).toBe(view.container.querySelector("[data-formbar-error-summary]"));
		view.unmount();
		consoleError.mockRestore();
	});

	it("fails duplicate, reserved, missing, invalid, and throwing extensions closed", () => {
		const throwing = () => {
			throw new Error("secret");
		};
		const extensions: RendererExtensions = {
			widgets: [
				rating,
				rating,
				{ id: "text", component: ReferenceWidget },
				{ id: "demo.invalid", component: ReferenceWidget, validateProps: () => false },
				{ id: "demo.validator", component: ReferenceWidget, validateProps: throwing },
				{ id: "demo.throw", component: throwing },
			],
		};
		const definition: FormDefinition = {
			version: 1,
			id: "failures",
			root: {
				type: "group",
				id: "root",
				children: ["demo.rating", "demo.missing", "demo.invalid", "demo.validator", "demo.throw"].map(
					(widget, index) => ({
						type: "field" as const,
						id: `field-${index}`,
						binding: binding(`value${index}`),
						widget,
					}),
				),
			},
		};
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const view = mountForm({
			schema: {
				type: "object",
				properties: Object.fromEntries(Array.from({ length: 5 }, (_, index) => [`value${index}`, { type: "integer" }])),
			},
			definition,
			data: { value0: 0, value1: 1, value2: 2, value3: 3, value4: 4 },
			extensions,
		});
		const codes = [...view.container.querySelectorAll("[data-formbar-diagnostic]")].map((node) =>
			node.getAttribute("data-formbar-diagnostic"),
		);
		expect(codes).toEqual(
			expect.arrayContaining([
				"duplicate-extension-id",
				"reserved-widget-id",
				"missing-extension",
				"invalid-extension-props",
				"extension-validator-failed",
				"extension-render-failed",
			]),
		);
		expect(view.container.textContent).not.toContain("secret");
		view.unmount();
		consoleError.mockRestore();
	});

	it("keeps the historical control set registry-only and expressible", () => {
		const ids = ["range", "color", "rating", "progress", "checkbox-group"];
		const widgets = ids.map((id) => ({ id, component: ReferenceWidget }));
		const definition: FormDefinition = {
			version: 1,
			id: "controls",
			root: {
				type: "group",
				id: "root",
				children: ids.map((widget, index) => ({
					type: "field" as const,
					id: `control-${index}`,
					binding: binding(`value${index}`),
					widget,
				})),
			},
		};
		const view = mountForm({
			schema: {
				type: "object",
				properties: Object.fromEntries(ids.map((_, index) => [`value${index}`, { type: "integer" }])),
			},
			definition,
			data: Object.fromEntries(ids.map((_, index) => [`value${index}`, index])),
			extensions: { widgets },
		});
		expect([...view.container.querySelectorAll("button")].map((node) => node.textContent)).toEqual(ids);
		view.unmount();
	});

	it("re-resolves registry identity and leaves React effect ownership StrictMode-safe", () => {
		let activeA = 0;
		let activeB = 0;
		const tracked = (kind: "a" | "b") => (props: WidgetProps) => {
			useEffect(() => {
				if (kind === "a") activeA += 1;
				else activeB += 1;
				return () => {
					if (kind === "a") activeA -= 1;
					else activeB -= 1;
				};
			}, [kind]);
			return <ReferenceWidget {...props} />;
		};
		const definition: FormDefinition = {
			version: 1,
			id: "replacement",
			root: { type: "field", id: "quality", binding: binding("quality"), widget: "demo.rating" },
		};
		const view = mountForm({
			schema: { type: "object", properties: { quality: { type: "integer" } } },
			definition,
			data: { quality: 2 },
			extensions: { widgets: [{ id: "demo.rating", component: tracked("a") }] },
			strict: true,
		});
		expect(activeA).toBe(1);
		act(() =>
			view.root.render(
				<StrictMode>
					<FormRenderer
						{...view.prepared}
						form={view.form}
						extensions={{ widgets: [{ id: "demo.rating", component: tracked("b") }] }}
					/>
				</StrictMode>,
			),
		);
		expect(activeA).toBe(0);
		expect(activeB).toBe(1);
		view.unmount();
		expect(activeA).toBe(0);
		expect(activeB).toBe(0);
	});
});
