import type { FormApi } from "@formbar/core";
import type { FormPresentation, LayoutNode, SchemaFormResult } from "@formbar/from-schema";
import { readDraftResult } from "./codec-runtime.js";
import type { TuiDiagnostic } from "./contracts.js";
import { type TuiFieldAdapterRegistry, type TuiFieldCodec, resolveMandatoryMaskedField } from "./field-adapters.js";
import type { NavigationModel } from "./navigation.js";
import { normalizeNavigation } from "./navigation.js";

export interface PreparedRenderer {
	readonly diagnostics: readonly TuiDiagnostic[];
	readonly navigation?: NavigationModel;
	readonly codecs: ReadonlyMap<string, TuiFieldCodec>;
	readonly disabled: ReadonlySet<string>;
}

export function prepareRenderer<TData, TUi>(
	presentation: FormPresentation,
	schema: SchemaFormResult,
	form: FormApi<TData, TUi>,
	registry: TuiFieldAdapterRegistry,
): PreparedRenderer {
	const layout = presentation.layout;
	const diagnostics: TuiDiagnostic[] = [];
	const codecs = new Map<string, TuiFieldCodec>();
	const disabled = new Set<string>();
	if (layout === null) return { diagnostics, codecs, disabled };
	const navigation = normalizeNavigation(layout);
	if (!navigation.ok)
		diagnostics.push(...navigation.diagnostics.map(({ message }) => diagnostic("invalid-renderer-input", message)));
	const fields = new Map(schema.fields.map((field) => [field.path, field]));
	visit(layout, (node) => {
		if (node.type === "array")
			diagnostics.push(diagnostic("unsupported-layout", "Array layouts are not supported", node.path));
		if (node.type !== "field" || node.path === undefined) return;
		const field = fields.get(node.path);
		const presented = presentation.fieldsByPath.get(node.path);
		if (!field || !presented) {
			diagnostics.push(diagnostic("invalid-renderer-input", "Layout field is missing from schema", node.path));
			return;
		}
		const context = { field, options: presented.options };
		const resolution = resolveMandatoryMaskedField(context) ?? registry.resolve(context);
		diagnostics.push(...resolution.diagnostics);
		if (!resolution.codec) return;
		if (
			!resolution.codec.masked &&
			!supportsInitial(resolution.codec, form.fieldDynamic(node.path).get(), node.path, diagnostics)
		)
			return;
		codecs.set(node.path, resolution.codec);
		if (presented.state.readOnly || presented.state.disabled) disabled.add(node.path);
	});
	return {
		diagnostics,
		...(navigation.ok ? { navigation: navigation.value } : {}),
		codecs,
		disabled,
	};
}

export function validatePreparedValues<TData, TUi>(
	prepared: PreparedRenderer,
	form: FormApi<TData, TUi>,
): readonly TuiDiagnostic[] {
	const diagnostics: TuiDiagnostic[] = [];
	for (const [path, codec] of prepared.codecs) {
		if (codec.masked) continue;
		supportsInitial(codec, form.fieldDynamic(path).get(), path, diagnostics);
	}
	return diagnostics;
}

function supportsInitial(codec: TuiFieldCodec, value: unknown, path: string, diagnostics: TuiDiagnostic[]): boolean {
	const result = readDraftResult(codec, value);
	if (result.kind === "success") return true;
	const message = result.kind === "malformed" ? "Field adapter failed" : "Unsupported initial field value";
	diagnostics.push(diagnostic("unsupported-field", message, path));
	return false;
}

function visit(node: LayoutNode, inspect: (node: LayoutNode) => void): void {
	inspect(node);
	for (const child of node.children ?? []) visit(child, inspect);
}

function diagnostic(code: TuiDiagnostic["code"], message: string, path?: string): TuiDiagnostic {
	return { code, severity: "error", message, ...(path === undefined ? {} : { path }) };
}
