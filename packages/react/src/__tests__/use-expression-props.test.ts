// @vitest-environment jsdom
import { createCoreExpressionNamespaces, createForm } from "@formbar/core";
import { createExpressionService, failure } from "@formbar/expressions";
import type { ExpressionService, PropDefinitions, ResolvedProps } from "@formbar/expressions";
import { StrictMode, act, createElement } from "react";
import type { FormEvent } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { literal, namespace, op, ref } from "../../../../test/expression-fixtures.js";
import { useExpressionProps } from "../index.js";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
let latest: ResolvedProps;

function Widget({ service, definitions }: { service: ExpressionService; definitions: PropDefinitions }) {
	latest = useExpressionProps(service, definitions);
	const { values, setters } = latest;
	return createElement(
		"section",
		{ "data-label": values.custom },
		createElement("input", {
			value: String(values.value ?? ""),
			onInput: (event: FormEvent<HTMLInputElement>) => setters.value?.(Number(event.currentTarget.value)),
		}),
		createElement("output", null, String(values.total ?? "")),
		createElement("button", { type: "button", disabled: Boolean(values.disabled) }, "Buy"),
		createElement("span", null, String(values.title ?? "")),
	);
}

const definitions: PropDefinitions = {
	value: { mode: "write", expression: ref("quantity") },
	total: {
		mode: "read",
		expression: op("add", op("mul", ref("quantity"), ref("unitPrice")), op("sub", ref("fee", "pricing"), literal(1))),
	},
	disabled: { mode: "read", expression: op("or", ref("locked", "ui"), op("lte", ref("quantity"), literal(0))) },
	custom: { mode: "read", expression: ref("label", "pricing") },
	title: { mode: "literal", value: "Order" },
};

const render = (service: ExpressionService, props = definitions) =>
	act(() => root.render(createElement(StrictMode, null, createElement(Widget, { service, definitions: props }))));
const input = () => container.querySelector("input") as HTMLInputElement;
const total = () => container.querySelector("output")?.textContent;
const edit = (value: string) =>
	act(() => {
		input().value = value;
		input().dispatchEvent(new Event("input", { bubbles: true }));
	});

beforeEach(() => {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

describe("mounted expression props", () => {
	it("clears actual DOM values and unmounts when disposal observers and provider cleanup throw", () => {
		const form = createForm({ initialData: { quantity: 2, unitPrice: 10 }, initialUiState: { locked: false } });
		form.onDispose(() => {
			throw new Error("SECRET disposal observer");
		});
		const external = namespace({ fee: 3, label: "Secret" });
		const service = createExpressionService({
			namespaces: {
				...createCoreExpressionNamespaces(form),
				pricing: {
					...external.provider,
					subscribe(listener) {
						const stop = external.provider.subscribe(listener);
						return () => {
							stop();
							throw new Error("SECRET cleanup");
						};
					},
				},
			},
		});
		render(service);
		expect(input().value).toBe("2");
		expect(total()).toBe("22");
		const retained = latest.setters.value;
		act(() => form.dispose());
		expect(input().value).toBe("");
		expect(total()).toBe("");
		expect(retained(7)).toEqual(failure("disposed"));
		expect(form.getDisposalDiagnostics()).toEqual([{ code: "adapter" }]);
		act(() => root.render(null));
		expect(external.listeners.size).toBe(0);
		expect(service.getLifecycleDiagnostics()).toEqual([{ code: "adapter" }]);
		service.dispose();
		form.dispose();
	});
	it("reacts to core edits and native input with arithmetic, disabled and ordinary custom props", () => {
		const form = createForm({ initialData: { quantity: 2, unitPrice: 10 }, initialUiState: { locked: false } });
		const external = namespace({ fee: 3, label: "Standard" });
		const service = createExpressionService({
			namespaces: { ...createCoreExpressionNamespaces(form), pricing: external.provider },
		});
		render(service);
		expect(input().value).toBe("2");
		expect(total()).toBe("22");
		expect(container.querySelector("section")?.dataset.label).toBe("Standard");
		expect(external.listeners.size).toBe(1);
		act(() => {
			form.setValue("unitPrice", 12);
		});
		expect(total()).toBe("26");
		edit("3");
		expect(form.getState().data.quantity).toBe(3);
		expect(total()).toBe("38");
		expect(latest.setters.total).toBeUndefined();
		expect(Object.hasOwn(form.getState().data, "total")).toBe(false);
		act(() => {
			form.dispatch({ type: "set-value", path: "$ui.locked", value: true });
		});
		expect(container.querySelector("button")?.disabled).toBe(true);
		act(() => external.replace({ fee: 5, label: "Express" }));
		expect(total()).toBe("40");
		expect(container.querySelector("section")?.dataset.label).toBe("Express");
		act(() => service.dispose());
		expect(total()).toBe("");
		expect(external.listeners.size).toBe(0);
		form.dispose();
	});
	it("rejects denied/stale writes, clears revoked values, and cleans StrictMode/unmount subscriptions", () => {
		let allowed = true;
		const form = createForm({ initialData: { quantity: 2, unitPrice: 10 }, initialUiState: { locked: false } });
		const external = namespace({ fee: 3, label: "Secret" });
		const service = createExpressionService({
			namespaces: { ...createCoreExpressionNamespaces(form), pricing: external.provider },
			authorize: () => allowed,
		});
		render(service);
		const retained = latest.setters.value;
		act(() => {
			allowed = false;
			service.invalidateAuthorization();
		});
		expect(input().value).toBe("");
		expect(container.querySelector("section")?.dataset.label).toBeUndefined();
		expect(retained(7)).toEqual(failure("denied"));
		edit("8");
		expect(form.getState().data.quantity).toBe(2);
		act(() => {
			allowed = true;
			service.invalidateAuthorization();
		});
		expect(retained(9)).toEqual(failure("stale"));
		const afterGrant = latest.setters.value;
		act(() => root.render(null));
		expect(external.listeners.size).toBe(0);
		expect(afterGrant(9)).toEqual(failure("stale"));
		service.dispose();
		form.dispose();
	});
	it("rebinds definitions and service without render-created observer leaks or former-target writes", () => {
		const external = namespace({ fee: 3, label: "First" });
		const first = createForm({ initialData: { quantity: 2, unitPrice: 10 }, initialUiState: { locked: false } });
		const second = createForm({ initialData: { quantity: 8, unitPrice: 10 }, initialUiState: { locked: false } });
		const service = createExpressionService({
			namespaces: { ...createCoreExpressionNamespaces(first), pricing: external.provider },
		});
		const replacement = createExpressionService({
			namespaces: { ...createCoreExpressionNamespaces(second), pricing: external.provider },
		});
		render(service);
		const old = latest.setters.value;
		render(service, { ...definitions, value: { mode: "write", expression: ref("unitPrice") } });
		expect(old(9)).toEqual(failure("stale"));
		expect(input().value).toBe("10");
		const rebound = latest.setters.value;
		render(replacement);
		expect(rebound(9)).toEqual(failure("stale"));
		expect(input().value).toBe("8");
		expect(external.listeners.size).toBe(1);
		act(() => {
			first.setValue("quantity", 99);
		});
		expect(input().value).toBe("8");
		edit("7");
		expect(second.getState().data.quantity).toBe(7);
		act(() => root.render(null));
		expect(external.listeners.size).toBe(0);
		service.dispose();
		replacement.dispose();
		first.dispose();
		second.dispose();
	});
});
