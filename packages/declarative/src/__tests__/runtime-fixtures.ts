import { createForm } from "@formbar/core";
import type { CreateFormOptions, FormApi } from "@formbar/core";
import type { Expression, FormDefinition, FormNode, ValidatedFormDefinition } from "../index.js";
import { createFormRuntime, validateFormDefinition } from "../index.js";
import { binding, literal } from "./fixtures.js";

export const dataRef = (segments: readonly (string | number)[], scope?: string): Expression => ({
	kind: "ref",
	ref: { namespace: "data", segments, ...(scope ? { scope } : {}) },
});

export const runtimeRef = (namespace: "field" | "form", segments: readonly string[]): Expression => ({
	kind: "ref",
	ref: { namespace, segments },
});

export const op = (name: string, ...args: Expression[]): Expression => ({ kind: "op", op: name, args });

export function definition(children: readonly FormNode[], root: Partial<FormNode> = {}): ValidatedFormDefinition {
	const candidate: FormDefinition = {
		version: 1,
		id: "runtime-test",
		root: { type: "group", id: "root", children, ...root } as FormNode,
	};
	const result = validateFormDefinition(candidate);
	if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
	return result.value;
}

export function field(id: string, segments: readonly (string | number)[], extra = {}): FormNode {
	return { type: "field", id, binding: binding(segments), widget: "text", ...extra };
}

export function runtime<TData extends object>(
	formDefinition: ValidatedFormDefinition,
	options: CreateFormOptions<TData, object>,
) {
	const form = createForm<TData, object>({ initialUiState: {}, ...options });
	return { form, runtime: createFormRuntime({ form, definition: formDefinition }) };
}

export function node(runtimePort: ReturnType<typeof createFormRuntime>, id: string, index = 0) {
	return runtimePort.getSnapshot().nodes.filter((item) => item.instance.nodeId === id)[index];
}

export function withForm<TData, TUi>(form: FormApi<TData, TUi>) {
	return form;
}

export { binding, literal };
