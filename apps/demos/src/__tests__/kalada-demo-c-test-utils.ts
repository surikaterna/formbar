import type { MountedDemo } from "./extension-demo-test-utils";

export function required<T extends Element>(element: T | null | undefined, description: string): T {
	if (!element) throw new Error(`Missing ${description}`);
	return element;
}

export function formSubmit(view: MountedDemo): HTMLButtonElement {
	return required(
		view.container.querySelector<HTMLButtonElement>('form[data-kalada-v1] button[type="submit"]'),
		"Kalada submit",
	);
}
