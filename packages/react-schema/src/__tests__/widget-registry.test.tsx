// @vitest-environment jsdom
import type { FormDefinition } from "@formbar/declarative";
import { Component, StrictMode, act, useEffect, useInsertionEffect, useLayoutEffect } from "react";
import type { ComponentType } from "react";
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

const lifecycleFailures: readonly [string, ComponentType<WidgetProps>][] = [
	[
		"render",
		(props) => {
			props.onChange(5);
			throw new Error("render");
		},
	],
	[
		"insertion effect",
		(props) => {
			useInsertionEffect(() => {
				props.onChange(6);
				throw new Error("insertion");
			}, [props.onChange]);
			return <ReferenceWidget {...props} />;
		},
	],
	[
		"layout effect",
		(props) => {
			useLayoutEffect(() => {
				props.onChange(7);
				throw new Error("layout");
			}, [props.onChange]);
			return <ReferenceWidget {...props} />;
		},
	],
	[
		"passive effect",
		(props) => {
			useEffect(() => {
				props.onChange(8);
				throw new Error("passive");
			}, [props.onChange]);
			return <ReferenceWidget {...props} />;
		},
	],
	[
		"class mount",
		class extends Component<WidgetProps> {
			componentDidMount(): void {
				this.props.onChange(9);
				throw new Error("mount");
			}

			render() {
				return <ReferenceWidget {...this.props} />;
			}
		},
	],
];

async function finishPassiveCommit(): Promise<void> {
	await act(async () => Promise.resolve());
}

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

	it("blocks policy writes and marks only the field touched on blur", async () => {
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
		await finishPassiveCommit();
		act(() => {
			received?.onChange(5);
			received?.onBlur();
		});
		expect(view.form.getState().data).toEqual({ quality: 2 });
		expect(view.form.fieldDynamic("/quality").isTouched()).toBe(true);
		view.unmount();
	});

	it.each([false, true])(
		"activates callbacks only after commit and invalidates stale render callbacks (strict: %s)",
		async (strict) => {
			const received: WidgetProps[] = [];
			let effectRan = false;
			const RenderWriter = (props: WidgetProps) => {
				received.push(props);
				props.onChange(99);
				props.onBlur();
				useEffect(() => {
					if (effectRan) return;
					effectRan = true;
					props.onChange(98);
					props.onBlur();
				}, [props.onBlur, props.onChange]);
				return <ReferenceWidget {...props} />;
			};
			const view = mountForm({
				schema: { type: "object", properties: { quality: { type: "integer" } } },
				definition: {
					version: 1,
					id: "commit-gate",
					root: { type: "field", id: "quality", binding: binding("quality"), widget: "demo.writer" },
				},
				data: { quality: 1 },
				extensions: { widgets: [{ id: "demo.writer", component: RenderWriter }] },
				strict,
			});
			await finishPassiveCommit();
			expect(view.form.getState().data).toEqual({ quality: 1 });
			expect(view.form.fieldDynamic("/quality").isTouched()).toBe(false);
			const committed = received.at(-1);
			act(() => {
				committed?.onChange(3);
				committed?.onBlur();
			});
			expect(view.form.getState().data).toEqual({ quality: 3 });
			expect(view.form.fieldDynamic("/quality").isTouched()).toBe(true);
			act(() => committed?.onChange(4));
			expect(view.form.getState().data).toEqual({ quality: 3 });
			const current = received.at(-1);
			view.unmount();
			current?.onChange(5);
			expect(view.form.getState().data).toEqual({ quality: 3 });
		},
	);

	it.each(lifecycleFailures)("does not activate callbacks when a %s fails", (_name, ThrowAfterWrite) => {
		let leaked: WidgetProps | undefined;
		const CaptureThenFail = (props: WidgetProps) => {
			leaked = props;
			return <ThrowAfterWrite {...props} />;
		};
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const view = mountForm({
			schema: { type: "object", properties: { quality: { type: "integer" } } },
			definition: {
				version: 1,
				id: "failed-commit-gate",
				root: { type: "field", id: "quality", binding: binding("quality"), widget: "demo.throw" },
			},
			data: { quality: 1 },
			extensions: { widgets: [{ id: "demo.throw", component: CaptureThenFail }] },
		});
		act(() => leaked?.onChange(2));
		expect(view.form.getState().data).toEqual({ quality: 1 });
		view.unmount();
		consoleError.mockRestore();
	});

	it.each([false, true])(
		"revokes stale callbacks before failing update layout lifecycles (strict: %s)",
		async (strict) => {
			const received: WidgetProps[] = [];
			const UpdateFailure = (props: WidgetProps) => {
				received.push(props);
				useLayoutEffect(() => {
					if (!props.props.fail) return;
					stale?.onChange(9);
					stale?.onBlur();
					throw new Error("update layout");
				}, [props.props.fail]);
				return <ReferenceWidget {...props} />;
			};
			const definition = (fail: boolean): FormDefinition => ({
				version: 1,
				id: "update-layout-gate",
				root: {
					type: "field",
					id: "quality",
					binding: binding("quality"),
					widget: "demo.update",
					props: { fail: literal(fail) },
				},
			});
			const extensions = { widgets: [{ id: "demo.update", component: UpdateFailure }] };
			const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
			const view = mountForm({
				schema: { type: "object", properties: { quality: { type: "integer" } } },
				definition: definition(false),
				data: { quality: 1 },
				extensions,
				strict,
			});
			await finishPassiveCommit();
			const stale = received.at(-1);
			const renderer = (
				<FormRenderer {...view.prepared} form={view.form} definition={definition(true)} extensions={extensions} />
			);
			act(() => view.root.render(strict ? <StrictMode>{renderer}</StrictMode> : renderer));
			expect(view.form.getState().data).toEqual({ quality: 1 });
			expect(view.form.fieldDynamic("/quality").isTouched()).toBe(false);
			expect(view.container.querySelector("[data-formbar-diagnostic]")?.getAttribute("data-formbar-diagnostic")).toBe(
				"extension-render-failed",
			);
			view.unmount();
			consoleError.mockRestore();
		},
	);

	it.each([false, true])(
		"revokes callbacks before descendant layout cleanup on unmount (strict: %s)",
		async (strict) => {
			let cleanups = 0;
			const CleanupWriter = (props: WidgetProps) => {
				useLayoutEffect(
					() => () => {
						cleanups += 1;
						props.onChange(7);
						props.onBlur();
					},
					[props.onBlur, props.onChange],
				);
				return <ReferenceWidget {...props} />;
			};
			const view = mountForm({
				schema: { type: "object", properties: { quality: { type: "integer" } } },
				definition: {
					version: 1,
					id: "unmount-layout-gate",
					root: { type: "field", id: "quality", binding: binding("quality"), widget: "demo.cleanup" },
				},
				data: { quality: 1 },
				extensions: { widgets: [{ id: "demo.cleanup", component: CleanupWriter }] },
				strict,
			});
			await finishPassiveCommit();
			expect(view.form.getState().data).toEqual({ quality: 1 });
			expect(view.form.fieldDynamic("/quality").isTouched()).toBe(false);
			view.unmount();
			expect(cleanups).toBe(strict ? 2 : 1);
			expect(view.form.getState().data).toEqual({ quality: 1 });
			expect(view.form.fieldDynamic("/quality").isTouched()).toBe(false);
		},
	);

	it.each([false, true])(
		"revokes stale callbacks before failing class update lifecycles (strict: %s)",
		async (strict) => {
			let current: WidgetProps | undefined;
			class UpdateFailure extends Component<WidgetProps> {
				componentDidUpdate(): void {
					if (!this.props.props.fail) return;
					stale?.onChange(9);
					stale?.onBlur();
					throw new Error("class update");
				}

				render() {
					current = this.props;
					return <ReferenceWidget {...this.props} />;
				}
			}
			const definition = (fail: boolean): FormDefinition => ({
				version: 1,
				id: "class-update-gate",
				root: {
					type: "field",
					id: "quality",
					binding: binding("quality"),
					widget: "demo.class-update",
					props: { fail: literal(fail) },
				},
			});
			const extensions = { widgets: [{ id: "demo.class-update", component: UpdateFailure }] };
			const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
			const view = mountForm({
				schema: { type: "object", properties: { quality: { type: "integer" } } },
				definition: definition(false),
				data: { quality: 1 },
				extensions,
				strict,
			});
			await finishPassiveCommit();
			const stale = current;
			const renderer = (
				<FormRenderer {...view.prepared} form={view.form} definition={definition(true)} extensions={extensions} />
			);
			act(() => view.root.render(strict ? <StrictMode>{renderer}</StrictMode> : renderer));
			expect(view.form.getState().data).toEqual({ quality: 1 });
			expect(view.form.fieldDynamic("/quality").isTouched()).toBe(false);
			expect(view.container.querySelector("[data-formbar-diagnostic]")?.getAttribute("data-formbar-diagnostic")).toBe(
				"extension-render-failed",
			);
			view.unmount();
			consoleError.mockRestore();
		},
	);

	it.each([false, true])("revokes callbacks before class unmount cleanup (strict: %s)", async (strict) => {
		let cleanups = 0;
		class CleanupWriter extends Component<WidgetProps> {
			componentWillUnmount(): void {
				cleanups += 1;
				this.props.onChange(7);
				this.props.onBlur();
			}

			render() {
				return <ReferenceWidget {...this.props} />;
			}
		}
		const view = mountForm({
			schema: { type: "object", properties: { quality: { type: "integer" } } },
			definition: {
				version: 1,
				id: "class-unmount-gate",
				root: { type: "field", id: "quality", binding: binding("quality"), widget: "demo.class-cleanup" },
			},
			data: { quality: 1 },
			extensions: { widgets: [{ id: "demo.class-cleanup", component: CleanupWriter }] },
			strict,
		});
		await finishPassiveCommit();
		expect(view.form.getState().data).toEqual({ quality: 1 });
		expect(view.form.fieldDynamic("/quality").isTouched()).toBe(false);
		view.unmount();
		expect(cleanups).toBe(strict ? 2 : 1);
		expect(view.form.getState().data).toEqual({ quality: 1 });
		expect(view.form.fieldDynamic("/quality").isTouched()).toBe(false);
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
			strict: true,
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
		const recovered: FormDefinition = {
			version: 1,
			id: definition.id,
			root: { type: "field", id: "quality", binding: binding("quality"), widget: "number" },
		};
		act(() =>
			view.root.render(
				<StrictMode>
					<FormRenderer {...view.prepared} form={view.form} definition={recovered} />
				</StrictMode>,
			),
		);
		expect(view.container.querySelector("[data-formbar-error-summary] a")).not.toBeNull();
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
		expect(codes.filter((code) => code === "reserved-widget-id")).toHaveLength(1);
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

	it("retries failed widgets only when a composite recovery input changes", () => {
		let attempts = 0;
		const Throw = () => {
			attempts += 1;
			throw new Error("widget");
		};
		const definition = (widget: string, segment: string, marker: string): FormDefinition => ({
			version: 1,
			id: "recovery",
			root: {
				type: "field",
				id: "quality",
				binding: binding(segment),
				widget,
				props: { marker: literal(marker) },
			},
		});
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const view = mountForm({
			schema: { type: "object", properties: { bad: { type: "integer" }, good: { type: "integer" } } },
			definition: definition("demo.a", "bad", "one"),
			data: { bad: 1, good: 2 },
			extensions: { widgets: [{ id: "demo.a", component: Throw }] },
		});
		const render = (next: FormDefinition, widgets: NonNullable<RendererExtensions["widgets"]>) =>
			act(() =>
				view.root.render(
					<FormRenderer {...view.prepared} form={view.form} definition={next} extensions={{ widgets }} />,
				),
			);
		const initialAttempts = attempts;
		expect(initialAttempts).toBeGreaterThan(0);
		render(definition("demo.a", "bad", "one"), [{ id: "demo.a", component: Throw }]);
		expect(attempts).toBe(initialAttempts);
		render(definition("demo.a", "bad", "two"), [{ id: "demo.a", component: Throw }]);
		const afterProps = attempts;
		expect(afterProps).toBeGreaterThan(initialAttempts);
		render(definition("demo.a", "good", "two"), [{ id: "demo.a", component: Throw }]);
		const afterBinding = attempts;
		expect(afterBinding).toBeGreaterThan(afterProps);
		render(definition("demo.b", "good", "two"), [{ id: "demo.b", component: Throw }]);
		expect(attempts).toBeGreaterThan(afterBinding);
		render(definition("demo.b", "good", "two"), [{ id: "demo.b", component: ReferenceWidget }]);
		expect(view.container.querySelector("button")?.textContent).toBe("demo.b");
		view.unmount();
		consoleError.mockRestore();
	});
});
