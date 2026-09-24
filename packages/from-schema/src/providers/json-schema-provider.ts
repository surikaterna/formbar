import { jsonSchemaProvider as upstreamProvider } from "@scheman/core";
import type { JsonSchemaProviderOptions, SchemaDocumentProvider } from "@scheman/core";

const supported = new WeakSet<SchemaDocumentProvider>();
const selected = new WeakSet<SchemaDocumentProvider>();

export function jsonSchemaProvider(options: JsonSchemaProviderOptions = {}): SchemaDocumentProvider {
	const provider = upstreamProvider(options);
	selected.add(provider);
	if (options.dialect === undefined || options.dialect === "draft-2020-12") supported.add(provider);
	return provider;
}

export function isJsonProvider(provider: SchemaDocumentProvider): boolean {
	return selected.has(provider);
}

export function isSupportedJsonProvider(provider: SchemaDocumentProvider): boolean {
	return supported.has(provider);
}
