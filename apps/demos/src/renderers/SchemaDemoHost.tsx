import { createArbiterPlugin } from "@formbar/arbiter";
import { jsonSchemaProvider } from "@formbar/from-schema";
import { FormRenderer, useSchemaForm } from "@formbar/react-schema";
import { useEffect, useState } from "react";
import type { SchemaDemoFixture, SchemaDemoSource } from "../demos/baseline-contracts";
import { CodeBlock } from "./CodeBlock";

const provider = jsonSchemaProvider({ dialect: "draft-2020-12" });
const noPlugins: readonly ReturnType<typeof detachedPlugin>[] = [];

export function SchemaDemoHost({ fixture }: { readonly fixture: SchemaDemoFixture }) {
	const [sourceKey, setSourceKey] = useState(fixture.sources[0].key);
	const source = fixture.sources.find((candidate) => candidate.key === sourceKey) ?? fixture.sources[0];
	return (
		<main className="schema-demo-host mx-auto max-w-5xl p-6 md:p-10">
			<header className="rounded-lg border border-info bg-info-background p-4">
				<h1 className="text-xl font-bold">{fixture.title}</h1>
				<p className="mt-1 text-sm text-muted-foreground">{fixture.copy}</p>
				{fixture.sources.length > 1 ? (
					<label className="mt-4 block text-sm font-medium">
						JSON Schema source
						<select className="ml-3" value={source.key} onChange={(event) => setSourceKey(event.currentTarget.value)}>
							{fixture.sources.map((candidate) => (
								<option key={candidate.key} value={candidate.key}>
									{candidate.label}
								</option>
							))}
						</select>
					</label>
				) : null}
			</header>
			<PreparedDemo key={`${fixture.id}:${source.key}`} source={source} />
		</main>
	);
}

function PreparedDemo({ source }: { readonly source: SchemaDemoSource }) {
	const committed = useCommittedArbiterPlugin(source.arbiterRules);
	if (!source.arbiterRules) return <RenderedDemo key="plain" source={source} plugins={noPlugins} />;
	if (!committed || committed.rules !== source.arbiterRules || !committed.active) return <PreparingRules />;
	return <RenderedDemo key="arbiter" source={source} plugins={committed.plugins} />;
}

interface CommittedPlugin {
	readonly rules: NonNullable<SchemaDemoSource["arbiterRules"]>;
	readonly plugins: readonly ReturnType<typeof detachedPlugin>[];
	active: boolean;
}

function useCommittedArbiterPlugin(rules: SchemaDemoSource["arbiterRules"]): CommittedPlugin | undefined {
	const [committed, setCommitted] = useState<CommittedPlugin>();
	useEffect(() => {
		if (!rules) return;
		const owned = createArbiterPlugin({ rules });
		const next: CommittedPlugin = { rules, plugins: [detachedPlugin(owned)], active: true };
		setCommitted(next);
		return () => {
			next.active = false;
			owned.onDispose?.();
		};
	}, [rules]);
	return committed;
}

function detachedPlugin(plugin: ReturnType<typeof createArbiterPlugin>) {
	return { ...plugin, onDispose: undefined };
}

function PreparingRules() {
	return (
		<section className="schema-demo-form mt-6 rounded-lg border border-border bg-card p-5" aria-busy="true">
			<output aria-live="polite">Preparing rule-governed form.</output>
		</section>
	);
}

function RenderedDemo({ source, plugins }: { readonly source: SchemaDemoSource; readonly plugins: typeof noPlugins }) {
	const prepared = useSchemaForm<Record<string, unknown>, Record<string, never>>(source.schema, {
		provider,
		side: "input",
		...(source.definition ? { definition: source.definition } : {}),
		initialData: source.initialData,
		plugins,
		onSubmit: async () => ({ ok: true, submitId: "demo-submit" }),
	});
	return (
		<>
			<section className="schema-demo-form mt-6 rounded-lg border border-border bg-card p-5">
				<FormRenderer {...prepared} />
				<div className="schema-demo-actions mt-5 flex gap-3 border-t border-border pt-4">
					<button type="button" onClick={() => void prepared.form.submit().catch(() => undefined)}>
						Submit
					</button>
					<button type="button" onClick={() => prepared.form.reset()}>
						Reset
					</button>
				</div>
			</section>
			<section className="mt-6 grid gap-4 lg:grid-cols-2" aria-label="Compiled source">
				<CodeBlock title={source.label} code={source.schema} />
				<CodeBlock title="Validated FormDefinition v1" code={prepared.definition} />
			</section>
		</>
	);
}
