import {
	type DocumentContext,
	type SchemaDocumentProvider,
	type ZodProviderOptions,
	zod4Provider as createZod4Provider,
} from "@scheman/core";

export function zod4Provider(options: ZodProviderOptions = {}): SchemaDocumentProvider {
	const provider = createZod4Provider(options);
	if (options.execution?.metadata !== "allow") return provider;
	return Object.freeze({
		name: provider.name,
		build(source: unknown, context: DocumentContext) {
			return provider.build(source, metadataAwareContext(context));
		},
	});
}

function metadataAwareContext(context: DocumentContext): DocumentContext {
	return {
		limits: context.limits,
		visit(source, side, sourcePointer, build) {
			materializeMetadataMethod(source, context, side, sourcePointer);
			return context.visit(source, side, sourcePointer, build);
		},
		node: (...args) => context.node(...args),
		copy: (...args) => context.copy(...args),
		diagnose: (...args) => context.diagnose(...args),
		capability: (...args) => context.capability(...args),
		definition: (...args) => context.definition(...args),
		metadata: (...args) => context.metadata(...args),
		available: () => context.available(),
	};
}

function materializeMetadataMethod(
	source: unknown,
	context: DocumentContext,
	side: "input" | "output",
	sourcePointer: string,
): void {
	if ((typeof source !== "object" || source === null) && typeof source !== "function") return;
	try {
		if (Object.getOwnPropertyDescriptor(source, "meta")) return;
		// Zod 4.5 installs public methods lazily; Scheman intentionally observes own evidence only.
		Reflect.get(source, "meta");
	} catch {
		context.diagnose("zod.execution.metadata.failed", side, sourcePointer);
	}
}
