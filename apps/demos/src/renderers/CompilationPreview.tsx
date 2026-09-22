import type { FormDefinition } from "@formbar/declarative";
import { jsonSchemaProvider } from "@formbar/from-schema";
import { useFormSelector } from "@formbar/react";
import { useSchemaForm } from "@formbar/react-schema";
import { CodeBlock } from "./CodeBlock";

interface CompilationPreviewProps {
	readonly schema: Record<string, unknown>;
	readonly definition?: FormDefinition;
	readonly initialData?: Record<string, unknown>;
}

export function CompilationPreview({ schema, definition, initialData }: CompilationPreviewProps) {
	const prepared = useSchemaForm<Record<string, unknown>, Record<string, unknown>>(schema, {
		provider: jsonSchemaProvider({ dialect: "draft-2020-12" }),
		side: "input",
		...(definition ? { definition } : {}),
		...(initialData ? { initialData } : {}),
	});
	const data = useFormSelector(prepared.form, (state) => state.data);
	return (
		<main className="mx-auto max-w-6xl p-6 md:p-10">
			<section className="rounded-lg border border-info bg-info-background p-4">
				<h1 className="text-xl font-bold">Schema compilation preview</h1>
				<p className="mt-2 text-sm text-muted-foreground">
					This playground remains a read-only compiler view. Numbered demos use the interactive production renderer.
				</p>
			</section>
			<div className="mt-6 grid gap-4 lg:grid-cols-2">
				<CodeBlock title="Validated FormDefinition v1" code={prepared.definition} />
				<CodeBlock title="Descriptor document and evidence" code={prepared.descriptors} />
				<CodeBlock title="Separated diagnostics" code={prepared.diagnostics} />
				<CodeBlock title="Current core data (read-only)" code={data} />
			</div>
		</main>
	);
}
