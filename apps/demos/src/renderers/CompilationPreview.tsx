import type { FormDefinition } from "@formbar/declarative";
import { CodeBlock } from "./CodeBlock";

interface CompilationPreviewProps {
	readonly schema: Record<string, unknown>;
	readonly definition?: FormDefinition;
	readonly initialData?: Record<string, unknown>;
}

export function CompilationPreview({ schema, definition, initialData }: CompilationPreviewProps) {
	return (
		<main className="mx-auto max-w-6xl p-6 md:p-10">
			<section className="rounded-lg border border-info bg-info-background p-4">
				<h1 className="text-xl font-bold">Schema compilation preview</h1>
				<p role="alert" className="mt-2 text-sm text-muted-foreground">
					The Kalada V1 compiler is available, but this preview has no app-installed data strategy or host policy. These
					are legacy sources, not a validated Kalada definition or an interactive form.
				</p>
			</section>
			<div className="mt-6 grid gap-4 lg:grid-cols-2">
				<CodeBlock title="JSON Schema source" code={schema} />
				<CodeBlock title="Legacy definition source (unvalidated)" code={definition ?? null} />
				<CodeBlock title="Initial data (read-only)" code={initialData ?? {}} />
			</div>
		</main>
	);
}
