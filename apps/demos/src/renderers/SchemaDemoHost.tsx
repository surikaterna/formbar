import { createArbiterPlugin } from "@formbar/arbiter";
import type { SubmitExecutionContext } from "@formbar/core";
import { jsonSchemaProvider } from "@formbar/from-schema";
import { FormRenderer, useSchemaForm } from "@formbar/react-schema";
import { useEffect, useId, useState } from "react";
import type { SchemaDemoFixture, SchemaDemoRuntimeProfile, SchemaDemoSource } from "../demos/baseline-contracts";
import { createJsonSchemaValidators } from "../validation/json-schema-validator";
import { CodeBlock } from "./CodeBlock";

const provider = jsonSchemaProvider({ dialect: "draft-2020-12" });
const noPlugins: readonly ReturnType<typeof detachedPlugin>[] = [];

interface SchemaDemoHostProps {
	readonly fixture: SchemaDemoFixture;
	readonly onSubmit?: (payload: Readonly<Record<string, unknown>>) => void;
}

export function SchemaDemoHost({ fixture, onSubmit }: SchemaDemoHostProps) {
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
			<PreparedDemo
				key={`${fixture.id}:${source.key}`}
				source={source}
				runtimeProfile={fixture.runtimeProfile}
				onSubmit={onSubmit}
			/>
		</main>
	);
}

function PreparedDemo({
	source,
	runtimeProfile,
	onSubmit,
}: {
	readonly source: SchemaDemoSource;
	readonly runtimeProfile?: SchemaDemoRuntimeProfile;
	readonly onSubmit?: SchemaDemoHostProps["onSubmit"];
}) {
	const committed = useCommittedArbiterPlugin(source.arbiterRules);
	if (!source.arbiterRules)
		return (
			<RenderedDemo
				key="plain"
				source={source}
				plugins={noPlugins}
				runtimeProfile={runtimeProfile}
				onSubmit={onSubmit}
			/>
		);
	if (!committed || committed.rules !== source.arbiterRules || !committed.active) return <PreparingRules />;
	return (
		<RenderedDemo
			key="arbiter"
			source={source}
			plugins={committed.plugins}
			runtimeProfile={runtimeProfile}
			onSubmit={onSubmit}
		/>
	);
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

interface RenderedDemoProps {
	readonly source: SchemaDemoSource;
	readonly plugins: typeof noPlugins;
	readonly runtimeProfile?: SchemaDemoRuntimeProfile;
	readonly onSubmit?: SchemaDemoHostProps["onSubmit"];
}

function RenderedDemo({ source, plugins, runtimeProfile, onSubmit }: RenderedDemoProps) {
	const [lastSubmission, setLastSubmission] = useState<string>();
	const variants = source.definitionVariants;
	const [variantKey, setVariantKey] = useState(variants?.[0].key);
	const activeVariant = variants?.find((variant) => variant.key === variantKey) ?? variants?.[0];
	const definition = activeVariant?.definition ?? source.definition;
	const validators = createJsonSchemaValidators(source.schema);
	const prepared = useSchemaForm<Record<string, unknown>, Record<string, never>>(source.schema, {
		provider,
		side: "input",
		...(definition ? { definition } : {}),
		initialData: source.initialData,
		plugins,
		validators,
		onSubmit: async ({ payload }: SubmitExecutionContext<Record<string, unknown>, Record<string, never>>) => {
			const snapshot = immutableSnapshot(payload);
			setLastSubmission(JSON.stringify(snapshot, null, 2));
			onSubmit?.(snapshot);
			return { ok: true, submitId: "demo-submit" };
		},
	});
	return (
		<>
			<section className="schema-demo-form mt-6 rounded-lg border border-border bg-card p-5">
				{variants ? (
					<label className="mb-5 block text-sm font-medium">
						Definition mode
						<select
							className="ml-3"
							value={activeVariant?.key}
							onChange={(event) => setVariantKey(event.currentTarget.value)}
						>
							{variants.map((variant) => (
								<option key={variant.key} value={variant.key}>
									{variant.label}
								</option>
							))}
						</select>
					</label>
				) : null}
				<FormRenderer {...prepared} extensions={runtimeProfile?.extensions} />
				<div className="schema-demo-actions mt-5 flex gap-3 border-t border-border pt-4">
					<button type="button" onClick={() => void prepared.form.submit().catch(() => undefined)}>
						Submit
					</button>
					<button type="button" onClick={() => prepared.form.reset()}>
						Reset
					</button>
				</div>
			</section>
			<SubmissionResult json={lastSubmission} />
			<section className="mt-6 grid gap-4 lg:grid-cols-2" aria-label="Compiled source">
				<CodeBlock title={source.label} code={source.schema} />
				<CodeBlock title="Validated FormDefinition v1" code={prepared.definition} />
			</section>
		</>
	);
}

function immutableSnapshot<T>(value: T): T {
	return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
	if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}

function SubmissionResult({ json }: { readonly json?: string }) {
	const headingId = useId();
	return (
		<section
			className="mt-6 rounded-lg border border-border bg-card p-5"
			aria-labelledby={headingId}
			aria-live="polite"
		>
			<h2 id={headingId} className="font-semibold">
				Last successful submission
			</h2>
			{json === undefined ? (
				<p className="mt-2 text-sm text-muted-foreground">No successful submission yet.</p>
			) : (
				<pre className="mt-2 overflow-auto rounded bg-muted p-3 text-sm">{json}</pre>
			)}
		</section>
	);
}
