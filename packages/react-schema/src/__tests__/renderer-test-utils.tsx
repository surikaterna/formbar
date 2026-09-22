import { createForm } from "@formbar/core";
import type { CreateFormOptions, FormApi } from "@formbar/core";
import type { FormDefinition } from "@formbar/declarative";
import { createSchemaForm, jsonSchemaProvider } from "@formbar/from-schema";
import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { FormRenderer } from "../index.js";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

export interface MountedForm<TData extends object, TUi extends object> {
	readonly container: HTMLDivElement;
	readonly root: Root;
	readonly form: FormApi<TData, TUi>;
	readonly prepared: ReturnType<typeof createSchemaForm<TData, TUi>>;
	unmount(): void;
}

export function mountForm<TData extends object, TUi extends object = Record<string, never>>(options: {
	readonly schema: unknown;
	readonly definition: FormDefinition;
	readonly data: TData;
	readonly uiState?: TUi;
	readonly formOptions?: Omit<CreateFormOptions<TData, TUi>, "initialData" | "initialUiState">;
	readonly strict?: boolean;
	readonly prepareForm?: (form: FormApi<TData, TUi>) => void;
}): MountedForm<TData, TUi> {
	const prepared = createSchemaForm<TData, TUi>(options.schema, {
		provider: jsonSchemaProvider(),
		side: "input",
		definition: options.definition,
	});
	const form = createForm<TData, TUi>({
		initialData: options.data,
		initialUiState: options.uiState ?? ({} as TUi),
		...options.formOptions,
	});
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	options.prepareForm?.(form);
	const renderer = <FormRenderer {...prepared} form={form} />;
	act(() => root.render(options.strict ? <StrictMode>{renderer}</StrictMode> : renderer));
	return {
		container,
		root,
		form,
		prepared,
		unmount() {
			act(() => root.unmount());
			container.remove();
			form.dispose();
		},
	};
}

export function binding(...segments: readonly (string | number)[]) {
	return { namespace: "data", segments } as const;
}

export function literal(value: string | number | boolean | null | readonly (string | number | boolean | null)[]) {
	return { mode: "literal", value } as const;
}

export function change(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
	act(() => {
		element.value = value;
		element.dispatchEvent(new Event("change", { bubbles: true }));
	});
}

export function input(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
	act(() => {
		const prototype =
			element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
		Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
		element.dispatchEvent(new Event("input", { bubbles: true }));
	});
}
