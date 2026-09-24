import { copyJson } from "@formbar/expressions";
import type { JsonValue } from "@formbar/expressions";
import type { DocumentContext, SchemaDocumentProvider, SchemaNode } from "@scheman/core";

const hintKey = "formbar.json-presentation.v1";

type CapturedHint =
	| { readonly status: "valid"; readonly value: Readonly<Record<string, JsonValue>> }
	| { readonly status: "invalid"; readonly options?: boolean };

export type JsonPresentationHint = CapturedHint | { readonly status: "absent" };

export function withJsonPresentationHints(provider: SchemaDocumentProvider): SchemaDocumentProvider {
	if (provider.name !== "json-schema") return provider;
	return Object.freeze({
		name: provider.name,
		build: (schema: unknown, context: DocumentContext) => provider.build(schema, hintContext(context)),
	});
}

export function jsonPresentationHint(metadata: unknown): JsonPresentationHint {
	const envelope = record(record(metadata)?.[hintKey]);
	if (envelope?.status === "invalid")
		return { status: "invalid", ...(envelope.options === true ? { options: true } : {}) };
	if (envelope?.status !== "valid") return { status: "absent" };
	const value = record(envelope.value);
	return value ? { status: "valid", value } : { status: "absent" };
}

function hintContext(context: DocumentContext): DocumentContext {
	return {
		limits: context.limits,
		visit(source, side, sourcePointer, build) {
			const hint = captureHint(source);
			return context.visit(source, side, sourcePointer, () => addHint(build(), hint));
		},
		node: (side, sourcePointer, build) => context.node(side, sourcePointer, build),
		copy: (value, side, sourcePointer) => context.copy(value, side, sourcePointer),
		diagnose: (code, side, sourcePointer) => context.diagnose(code, side, sourcePointer),
		capability: (side, availability) => context.capability(side, availability),
		definition(side, sourcePointer, node, name) {
			if (name === undefined) context.definition(side, sourcePointer, node);
			else context.definition(side, sourcePointer, node, name);
		},
		metadata: (value) => context.metadata(value),
		available: () => context.available(),
	};
}

function captureHint(source: unknown): CapturedHint | undefined {
	if ((typeof source !== "object" && typeof source !== "function") || source === null) return undefined;
	let descriptor: PropertyDescriptor | undefined;
	try {
		descriptor = Object.getOwnPropertyDescriptor(source, "x-formbar");
	} catch {
		return { status: "invalid" };
	}
	if (!descriptor) return undefined;
	if (!("value" in descriptor)) return { status: "invalid" };
	try {
		const copied = copyJson(descriptor.value);
		const value = record(copied);
		return value ? { status: "valid", value } : { status: "invalid" };
	} catch {
		try {
			return { status: "invalid", options: Object.hasOwn(descriptor.value, "options") };
		} catch {
			return { status: "invalid" };
		}
	}
}

function addHint(node: SchemaNode, hint: CapturedHint | undefined): SchemaNode {
	if (!hint) return node;
	const metadata = record(node.metadata) ?? Object.create(null);
	return { ...node, metadata: { ...metadata, [hintKey]: hint } } as SchemaNode;
}

function record(value: unknown): Readonly<Record<string, JsonValue>> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Readonly<Record<string, JsonValue>>)
		: undefined;
}
