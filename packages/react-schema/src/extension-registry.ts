import type { FieldNode, JsonValue } from "@formbar/declarative";
import type {
	CustomNodeRegistration,
	ExtensionProps,
	RendererExtensions,
	WidgetRegistration,
} from "./extension-types.js";
import type { RendererDiagnostic } from "./renderer-evidence.js";

export interface RegistryDiagnostic {
	readonly code: RendererDiagnostic;
	readonly extensionId: string;
}

export interface ExtensionRegistry {
	readonly widgets: ReadonlyMap<string, WidgetRegistration>;
	readonly nodes: ReadonlyMap<string, CustomNodeRegistration>;
	readonly diagnostics: readonly RegistryDiagnostic[];
}

export type ExtensionResolution<T> =
	| { readonly ok: true; readonly registration: T; readonly props: ExtensionProps }
	| { readonly ok: false; readonly code: RendererDiagnostic };

export const NATIVE_WIDGETS = new Set([
	"text",
	"textarea",
	"number",
	"select",
	"checkbox",
	"radio",
	"date",
	"time",
	"email",
	"url",
	"tel",
	"password",
	"search",
	"unsupported",
]);

export function normalizeExtensions(extensions: RendererExtensions | undefined): ExtensionRegistry {
	const diagnostics: RegistryDiagnostic[] = [];
	const widgets = registrations(extensions?.widgets ?? [], "widget", diagnostics, NATIVE_WIDGETS);
	const nodes = registrations(extensions?.nodes ?? [], "node", diagnostics);
	return Object.freeze({ widgets, nodes, diagnostics: Object.freeze(diagnostics) });
}

export function resolveWidget(
	registry: ExtensionRegistry,
	node: Pick<FieldNode, "widget" | "props">,
): ExtensionResolution<WidgetRegistration> {
	const registration = registry.widgets.get(node.widget);
	if (!registration) return { ok: false, code: "missing-extension" };
	return validateRegistration(registration, node.props);
}

export function resolveCustomNode(
	registry: ExtensionRegistry,
	id: string,
	props: FieldNode["props"],
): ExtensionResolution<CustomNodeRegistration> {
	const registration = registry.nodes.get(id);
	if (!registration) return { ok: false, code: "missing-extension" };
	return validateRegistration(registration, props);
}

function registrations<T extends { readonly id: string }>(
	input: readonly T[],
	kind: "widget" | "node",
	diagnostics: RegistryDiagnostic[],
	reserved?: ReadonlySet<string>,
): ReadonlyMap<string, T> {
	const counts = new Map<string, number>();
	for (const item of input) counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
	const output = new Map<string, T>();
	for (const item of input) {
		if (!safeId(item.id)) {
			diagnostics.push({ code: "invalid-extension-registration", extensionId: safeDiagnosticId(item.id) });
			continue;
		}
		if (reserved?.has(item.id)) {
			diagnostics.push({ code: "reserved-widget-id", extensionId: item.id });
			continue;
		}
		if ((counts.get(item.id) ?? 0) > 1) {
			if (
				!diagnostics.some(
					(diagnostic) => diagnostic.code === "duplicate-extension-id" && diagnostic.extensionId === item.id,
				)
			)
				diagnostics.push({ code: "duplicate-extension-id", extensionId: item.id });
			continue;
		}
		output.set(item.id, item);
	}
	return output;
}

function validateRegistration<T extends { readonly validateProps?: (props: ExtensionProps) => boolean }>(
	registration: T,
	definitions: FieldNode["props"],
): ExtensionResolution<T> {
	const props = literalProps(definitions);
	if (!props) return { ok: false, code: "invalid-extension-props" };
	try {
		if (registration.validateProps && !registration.validateProps(props))
			return { ok: false, code: "invalid-extension-props" };
	} catch {
		return { ok: false, code: "extension-validator-failed" };
	}
	return { ok: true, registration, props };
}

function literalProps(definitions: FieldNode["props"]): ExtensionProps | undefined {
	const output: Record<string, JsonValue> = Object.create(null);
	for (const [key, spec] of Object.entries(definitions ?? {})) {
		if (spec.mode !== "literal") return undefined;
		output[key] = spec.value;
	}
	return Object.freeze(output);
}

function safeId(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 256 &&
		value !== "__proto__" &&
		value !== "constructor" &&
		value !== "prototype"
	);
}

function safeDiagnosticId(value: unknown): string {
	return typeof value === "string" && value.length <= 256 ? value : "invalid";
}
