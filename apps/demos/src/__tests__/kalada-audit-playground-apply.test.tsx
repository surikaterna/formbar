// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { PlaygroundPage } from "../playground/PlaygroundPage";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
function button(container: HTMLElement, label: string) {
	const found = [...container.querySelectorAll("button")].find((node) => node.textContent === label);
	if (!found) throw new Error(`Missing ${label}`);
	return found;
}

it("R13 REAL custom widget playground Apply preserves user edits and the selected context", async () => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	try {
		await act(async () =>
			root.render(
				<PlaygroundPage
					demoId="custom-renderers"
					variant="authored-overrides"
					onClose={() => {}}
					onDemoChange={() => {}}
					onPresetChange={() => {}}
				/>,
			),
		);
		const input = [...container.querySelectorAll<HTMLLabelElement>('[aria-label="Running preview"] label')].find(
			(node) => node.textContent === "Product Name",
		)?.control;
		expect(input).toBeInstanceOf(HTMLInputElement);
		act(() => {
			Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "User product");
			input?.dispatchEvent(new Event("input", { bubbles: true }));
		});
		await act(async () => button(container, "Apply").click());
		expect(container.textContent).toContain("Document applied.");
		const current = [...container.querySelectorAll<HTMLLabelElement>('[aria-label="Running preview"] label')].find(
			(node) => node.textContent === "Product Name",
		)?.control;
		expect((current as HTMLInputElement).value).toBe("User product");
		expect(container.querySelector('[aria-label="Running preview"] [role="alert"]')).toBeNull();
		expect(container.querySelectorAll('[data-widget="demo16.rating"]')).toHaveLength(2);
	} finally {
		act(() => root.unmount());
		container.remove();
		window.localStorage.clear();
	}
});
