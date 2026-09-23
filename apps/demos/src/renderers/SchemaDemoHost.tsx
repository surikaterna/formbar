import { createSchemaForm, jsonSchemaProvider } from "@formbar/from-schema";
import { useState } from "react";
import type { SchemaDemoFixture, SchemaDemoSource } from "../demos/baseline-contracts";
import type { PlaygroundDocument } from "../playground/contracts";
import { runtimeProfileIdsFor } from "../runtime/runtime-profile-selection";
import { CodeBlock } from "./CodeBlock";
import { SchemaFormRuntime } from "./SchemaFormRuntime";

const provider = jsonSchemaProvider({ dialect: "draft-2020-12" });

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
					<SourceChooser fixture={fixture} value={source.key} onChange={setSourceKey} />
				) : null}
			</header>
			<PreparedDemo key={`${fixture.id}:${source.key}`} fixture={fixture} source={source} onSubmit={onSubmit} />
		</main>
	);
}

function SourceChooser(props: {
	readonly fixture: SchemaDemoFixture;
	readonly value: string;
	readonly onChange: (key: string) => void;
}) {
	return (
		<label className="mt-4 block text-sm font-medium">
			JSON Schema source
			<select className="ml-3" value={props.value} onChange={(event) => props.onChange(event.currentTarget.value)}>
				{props.fixture.sources.map((source) => (
					<option key={source.key} value={source.key}>
						{source.label}
					</option>
				))}
			</select>
		</label>
	);
}

function PreparedDemo(props: {
	readonly fixture: SchemaDemoFixture;
	readonly source: SchemaDemoSource;
	readonly onSubmit?: SchemaDemoHostProps["onSubmit"];
}) {
	const variants = props.source.definitionVariants;
	const [variantKey, setVariantKey] = useState(variants?.[0].key);
	const variant = variants?.find(({ key }) => key === variantKey) ?? variants?.[0];
	const definition = variant?.definition ?? props.source.definition ?? generatedDefinition(props.source);
	const document: PlaygroundDocument = {
		version: 2,
		schema: props.source.schema,
		definition,
		initialData: props.source.initialData,
	};
	return (
		<>
			{variants ? <DefinitionChooser variants={variants} value={variant?.key ?? ""} onChange={setVariantKey} /> : null}
			<SchemaFormRuntime
				document={document}
				profileIds={runtimeProfileIdsFor(props.fixture, props.source)}
				initialUiState={props.source.initialUiState}
				arbiterRules={props.source.arbiterRules}
				actionControls={props.fixture.actionControls}
				onSubmit={props.onSubmit}
				showObservability
			/>
			<section className="mt-6 grid gap-4 lg:grid-cols-2" aria-label="Compiled source">
				<CodeBlock title={props.source.label} code={props.source.schema} />
				<CodeBlock title="Validated FormDefinition v1" code={definition} />
			</section>
		</>
	);
}

function DefinitionChooser(props: {
	readonly variants: NonNullable<SchemaDemoSource["definitionVariants"]>;
	readonly value: string;
	readonly onChange: (key: string) => void;
}) {
	return (
		<label className="mt-5 block text-sm font-medium">
			Definition mode
			<select className="ml-3" value={props.value} onChange={(event) => props.onChange(event.currentTarget.value)}>
				{props.variants.map((variant) => (
					<option key={variant.key} value={variant.key}>
						{variant.label}
					</option>
				))}
			</select>
		</label>
	);
}

function generatedDefinition(source: SchemaDemoSource) {
	return createSchemaForm(source.schema, { provider, side: "input" }).definition;
}
