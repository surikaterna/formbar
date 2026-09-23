import type { FormNode } from "@formbar/declarative";
import { createSchemaForm, jsonSchemaProvider } from "@formbar/from-schema";
import type { SchemaDemoSource } from "../demos/baseline-contracts";
import { type DemoRegistration, demos } from "../demos/registry";
import { runtimeProfileIdsFor } from "../runtime/runtime-profile-selection";
import { resolveTrustedRuntimeProfiles } from "../runtime/trusted-runtime-profiles";
import {
	type DemoCompatibility,
	PLAYGROUND_DOCUMENT_VERSION,
	type PlaygroundExample,
	type RuntimeCapabilityDeclaration,
} from "./contracts";

const provider = jsonSchemaProvider({ dialect: "draft-2020-12" });
let projected: readonly PlaygroundExample[] | undefined;

export function getPlaygroundExamples(): readonly PlaygroundExample[] {
	projected ??= deepFreeze(demos.flatMap(projectRegistration));
	return projected;
}

export function getExamplesForDemo(demoId: string): readonly PlaygroundExample[] {
	return getPlaygroundExamples().filter((example) => example.demoId === demoId);
}

export function getPlaygroundExample(demoId: string, variant?: string): PlaygroundExample | undefined {
	const examples = getExamplesForDemo(demoId);
	return examples.find((example) => exampleVariant(example) === variant) ?? examples[0];
}

export function exampleVariant(example: PlaygroundExample): string {
	return [example.sourceKey, example.definitionKey].filter(Boolean).join(":");
}

export function getPlaygroundCompatibility(): readonly DemoCompatibility[] {
	return demos.map((registration) => ({
		demoId: registration.id,
		support: registration.playground.support,
		...(registration.playground.support === "unsupported" ? { reason: registration.playground.reason } : {}),
		presets:
			registration.playground.support === "full"
				? registration.fixture.sources.flatMap((source) =>
						(source.definitionVariants ?? [undefined]).map((variant) => ({
							variant: [source.key, variant?.key].filter(Boolean).join(":"),
						})),
					)
				: [],
	}));
}

function projectRegistration(registration: DemoRegistration): readonly PlaygroundExample[] {
	if (registration.playground.support === "unsupported") return [];
	return registration.fixture.sources.flatMap((source) => projectSource(registration, source));
}

function projectSource(registration: DemoRegistration, source: SchemaDemoSource): readonly PlaygroundExample[] {
	if (source.definitionVariants) {
		return source.definitionVariants.map((variant) =>
			createExample(registration, source, variant.definition, variant.key, variant.label),
		);
	}
	const definition = source.definition ?? createSchemaForm(source.schema, { provider, side: "input" }).definition;
	return [createExample(registration, source, definition)];
}

function createExample(
	registration: DemoRegistration,
	source: SchemaDemoSource,
	definition: PlaygroundExample["document"]["definition"],
	definitionKey?: string,
	definitionLabel?: string,
): PlaygroundExample {
	const profileIds = runtimeProfileIdsFor(registration.fixture, source);
	const resolved = resolveTrustedRuntimeProfiles(profileIds);
	if (!resolved.ok) throw new Error(`Invalid runtime profiles for ${registration.id}`);
	const actionControls = registration.fixture.actionControls ?? "host";
	return {
		key: [registration.id, source.key, definitionKey].filter(Boolean).join(":"),
		demoId: registration.id,
		...(registration.number === undefined ? {} : { number: registration.number }),
		sourceKey: source.key,
		...(definitionKey ? { definitionKey } : {}),
		display: {
			demoTitle: registration.title,
			sourceLabel: source.label,
			...(definitionLabel ? { definitionLabel } : {}),
		},
		document: {
			version: PLAYGROUND_DOCUMENT_VERSION,
			schema: jsonClone(source.schema),
			definition: jsonClone(definition),
			initialData: jsonClone(source.initialData),
		},
		runtime: {
			profileIds,
			capabilities: uniqueCapabilities([
				...resolved.capabilities,
				...actionCapabilities(definition, actionControls),
				{ kind: "action-controls", id: actionControls },
			]),
			initialUiState: jsonClone(source.initialUiState ?? {}),
			...(source.arbiterRules ? { arbiterRules: jsonClone(source.arbiterRules) } : {}),
			actionControls,
			editable: ["schema", "definition", "initialData"],
			fixed: [
				"profileIds",
				"capabilities",
				"initialUiState",
				...(source.arbiterRules ? ["arbiterRules" as const] : []),
				"actionControls",
			],
		},
	};
}

function actionCapabilities(
	definition: PlaygroundExample["document"]["definition"],
	actionControls: "host" | "definition",
): RuntimeCapabilityDeclaration[] {
	const definitionActions = allNodes(definition.root).flatMap((node) =>
		node.type === "action" ? [{ kind: "action" as const, id: node.action }] : [],
	);
	const hostActions = actionControls === "host" ? ["submit", "reset"] : [];
	return [...definitionActions, ...hostActions.map((id) => ({ kind: "action" as const, id }))];
}

function allNodes(node: FormNode): readonly FormNode[] {
	if (node.type === "group" || node.type === "section" || node.type === "repeater" || node.type === "custom") {
		return [node, ...(node.children ?? []).flatMap(allNodes)];
	}
	if (node.type === "tabs") return [node, ...node.tabs.flatMap((tab) => tab.children.flatMap(allNodes))];
	if (node.type === "accordion") return [node, ...node.items.flatMap((item) => item.children.flatMap(allNodes))];
	if (node.type === "conditional")
		return [node, ...node.then.flatMap(allNodes), ...(node.else ?? []).flatMap(allNodes)];
	return [node];
}

function uniqueCapabilities(
	capabilities: readonly RuntimeCapabilityDeclaration[],
): readonly RuntimeCapabilityDeclaration[] {
	const seen = new Set<string>();
	return capabilities.filter((capability) => {
		const key = `${capability.kind}:${capability.id}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function jsonClone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
	if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
