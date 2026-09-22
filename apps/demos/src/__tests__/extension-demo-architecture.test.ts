import { createForm } from "@formbar/core";
import type { FormDefinition, FormNode } from "@formbar/declarative";
import { createSchemaForm, jsonSchemaProvider } from "@formbar/from-schema";
import { FormRenderer } from "@formbar/react-schema";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { customRenderersDemo } from "../demos/16-custom-renderers";
import widgetFixtureSource from "../demos/16-custom-renderers.ts?raw";
import { customLayoutDefinitionVariants, customLayoutTypesDemo } from "../demos/17-custom-layout";
import layoutFixtureSource from "../demos/17-custom-layout.ts?raw";
import { demos } from "../demos/index";
import { customLayoutProfile } from "../extensions/custom-layout-profile";
import layoutProfileSource from "../extensions/custom-layout-profile.tsx?raw";
import { customWidgetProfile } from "../extensions/custom-widget-profile";
import widgetProfileSource from "../extensions/custom-widget-profile.tsx?raw";
import hostSource from "../renderers/SchemaDemoHost.tsx?raw";

const provider = jsonSchemaProvider({ dialect: "draft-2020-12" });

function childNodes(node: FormNode): readonly FormNode[] {
	if (node.type === "group" || node.type === "section" || node.type === "repeater") return node.children;
	if (node.type === "custom") return node.children ?? [];
	if (node.type === "tabs") return node.tabs.flatMap((tab) => tab.children);
	if (node.type === "accordion") return node.items.flatMap((item) => item.children);
	if (node.type === "conditional") return [...node.then, ...(node.else ?? [])];
	return [];
}

function allNodes(node: FormNode): readonly FormNode[] {
	return [node, ...childNodes(node).flatMap(allNodes)];
}

function compile(schema: Readonly<Record<string, unknown>>, definition?: FormDefinition) {
	return createSchemaForm<Record<string, unknown>, Record<string, never>>(schema, {
		provider,
		side: "input",
		...(definition ? { definition } : {}),
	});
}

function jsonRoundTrip(value: unknown): unknown {
	return JSON.parse(JSON.stringify(value));
}

function evidenceAt(result: ReturnType<typeof compile>, path: string) {
	const occurrence = Object.values(result.descriptors.occurrences).find(
		(candidate) => candidate.path.length === 1 && candidate.path[0] === path,
	);
	if (!occurrence) throw new Error(`Missing descriptor ${path}`);
	return result.descriptors.evidence[occurrence.nodeId];
}

function serverRender(fixture: typeof customRenderersDemo | typeof customLayoutTypesDemo): string {
	const source = fixture.sources[0];
	const definition = source.definition ?? source.definitionVariants?.[0].definition;
	const prepared = compile(source.schema, definition);
	const form = createForm<Record<string, unknown>, Record<string, never>>({
		initialData: { ...source.initialData },
		initialUiState: {},
	});
	const html = renderToString(
		createElement(FormRenderer<Record<string, unknown>, Record<string, never>>, {
			...prepared,
			form,
			extensions: fixture.runtimeProfile?.extensions,
		}),
	);
	form.dispose();
	return html;
}

function oversizedFunctions(source: string, fileName: string): readonly string[] {
	const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
	const oversized: string[] = [];
	const visit = (node: ts.Node): void => {
		const functionNode = ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node);
		if (functionNode && node.body) {
			const start = file.getLineAndCharacterOfPosition(node.getStart(file)).line;
			const end = file.getLineAndCharacterOfPosition(node.end).line;
			const name = ts.isFunctionDeclaration(node) ? (node.name?.text ?? "anonymous") : `callback:${start + 1}`;
			if (end - start + 1 > 50) oversized.push(`${fileName}:${name}:${end - start + 1}`);
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	return oversized;
}

describe("extension demo architecture", () => {
	it("keeps production functions within budget and layout paths statically typed", () => {
		const sources = [
			["16-custom-renderers.ts", widgetFixtureSource],
			["17-custom-layout.ts", layoutFixtureSource],
			["custom-widget-profile.tsx", widgetProfileSource],
			["custom-layout-profile.tsx", layoutProfileSource],
			["SchemaDemoHost.tsx", hostSource],
		] as const;
		expect(sources.flatMap(([name, source]) => oversizedFunctions(source, name))).toEqual([]);
		expect(layoutFixtureSource).toContain("function fields(paths: readonly FieldPath[])");
		expect(layoutFixtureSource).toContain("function grid(id: string, paths: readonly FieldPath[])");
		expect(layoutFixtureSource).not.toMatch(/path as FieldPath|paths: readonly string\[\]/);
	});

	it("keeps fixtures serializable and executable values confined to frozen profiles", () => {
		for (const fixture of [customRenderersDemo, customLayoutTypesDemo]) {
			for (const source of fixture.sources) {
				expect(jsonRoundTrip(source.schema)).toEqual(source.schema);
				if (source.definition) expect(jsonRoundTrip(source.definition)).toEqual(source.definition);
				for (const variant of source.definitionVariants ?? []) {
					expect(jsonRoundTrip(variant.definition)).toEqual(variant.definition);
				}
			}
		}
		expect(Object.isFrozen(customWidgetProfile)).toBe(true);
		expect(Object.isFrozen(customWidgetProfile.extensions.widgets)).toBe(true);
		expect(Object.isFrozen(customLayoutProfile)).toBe(true);
		expect(Object.isFrozen(customLayoutProfile.extensions.nodes)).toBe(true);
		expect(`${widgetFixtureSource}\n${layoutFixtureSource}`).not.toMatch(
			/from ["']react|useSchemaForm|FormRenderer|<(?:input|select|textarea)/,
		);
		expect(`${widgetProfileSource}\n${layoutProfileSource}`).not.toMatch(
			/FormNodeView|renderChild|fieldDynamic|useFormSelector|form\./,
		);
		expect(
			`${widgetFixtureSource}\n${layoutFixtureSource}\n${widgetProfileSource}\n${layoutProfileSource}`,
		).not.toMatch(/import\s*\(|\beval\s*\(|https?:\/\/|globalThis/);
	});

	it("registers stable routes, fixtures, profile IDs, and exact extension IDs", () => {
		expect(demos.map((demo) => demo.id).slice(10, 14)).toEqual([
			"kitchen-sink",
			"custom-renderers",
			"custom-layout-types",
			"arbiter-visibility",
		]);
		for (const id of ["custom-renderers", "custom-layout-types"]) {
			const registration = demos.find((demo) => demo.id === id);
			expect(registration?.fixture?.id).toBe(id);
			expect(Object.isFrozen(registration)).toBe(true);
		}
		expect(customWidgetProfile.id).toBe("demo16.trusted-widgets.v1");
		expect(customWidgetProfile.extensions.widgets?.map((entry) => entry.id)).toEqual([
			"demo16.rating",
			"demo16.color",
			"demo16.checkbox-group",
			"demo16.range",
			"demo16.progress",
		]);
		expect(customLayoutProfile.id).toBe("demo17.advanced-layout.v1");
		expect(customLayoutProfile.extensions.nodes?.map((entry) => entry.id)).toEqual([
			"demo17.inspection-panel",
			"demo17.field-grid",
		]);
	});

	it("preserves demo 16 domains and proves generated versus authored precedence", () => {
		const [generatedSource, authoredSource, diagnosticSource] = customRenderersDemo.sources;
		const schema = generatedSource.schema as { properties: Record<string, Record<string, unknown>> };
		const generated = compile(generatedSource.schema);
		const authored = compile(authoredSource.schema, authoredSource.definition);
		const generatedFields = allNodes(generated.definition.root).filter((node) => node.type === "field");
		const authoredFields = allNodes(authored.definition.root).filter((node) => node.type === "field");
		expect(generatedFields.map((node) => node.widget)).toEqual([
			"text",
			"demo16.rating",
			"demo16.rating",
			"demo16.color",
			"demo16.color",
			"demo16.checkbox-group",
			"demo16.progress",
			"textarea",
		]);
		expect(authoredFields.map((node) => node.widget)).toEqual([
			"text",
			"demo16.rating",
			"demo16.rating",
			"demo16.color",
			"demo16.color",
			"demo16.checkbox-group",
			"demo16.range",
			"textarea",
		]);
		expect((authoredFields[1] as Extract<FormNode, { type: "field" }>).props?.icon).toEqual({
			mode: "literal",
			value: "heart",
		});
		expect(evidenceAt(generated, "qualityRating")).toMatchObject({
			primitive: "integer",
			minimum: 0,
			maximum: 5,
			multipleOf: 1,
		});
		expect(evidenceAt(authored, "completionRate")).toMatchObject({
			primitive: "integer",
			minimum: 0,
			maximum: 100,
			multipleOf: 1,
		});
		expect(customRenderersDemo.copy).toBe(
			"Demonstrates custom field renderers using x-formbar metadata extensions. Star ratings, color pickers, checkbox groups, and progress bars — all driven by schema metadata.",
		);
		expect(customRenderersDemo.sources.map((source) => source.key)).toEqual([
			"schema-hints",
			"authored-overrides",
			"extension-diagnostics",
		]);
		expect(Object.keys(schema.properties)).toEqual([
			"productName",
			"qualityRating",
			"userSatisfaction",
			"brandColor",
			"accentColor",
			"tags",
			"completionRate",
			"notes",
		]);
		expect(schema.properties.brandColor.enum).toEqual([
			"#3B82F6",
			"#EF4444",
			"#10B981",
			"#F59E0B",
			"#8B5CF6",
			"#EC4899",
			"#06B6D4",
			"#F97316",
		]);
		expect(schema.properties.accentColor.enum).toEqual([
			"#1E293B",
			"#334155",
			"#475569",
			"#64748B",
			"#94A3B8",
			"#CBD5E1",
			"#E2E8F0",
			"#F8FAFC",
		]);
		expect((schema.properties.tags.items as { enum: string[] }).enum).toEqual([
			"Performance",
			"Usability",
			"Design",
			"Reliability",
			"Security",
		]);
		expect(schema.properties.brandColor.pattern).toBe("^#[0-9a-fA-F]{6}$");
		expect(schema.properties.accentColor.pattern).toBe("^#[0-9a-fA-F]{6}$");
		expect(generatedSource.initialData).toEqual({
			productName: "",
			qualityRating: 0,
			userSatisfaction: 0,
			brandColor: "",
			accentColor: "",
			tags: [],
			completionRate: 0,
			notes: "",
		});
		expect((authoredSource.schema as typeof schema).properties.qualityRating["x-formbar"]).toMatchObject({
			widget: "demo16.color",
		});
		const diagnostic = compile(diagnosticSource.schema, diagnosticSource.definition);
		const diagnosticIds = allNodes(diagnostic.definition.root).map((node) =>
			node.type === "field" ? node.widget : node.type === "custom" ? node.renderer : "",
		);
		expect(diagnosticIds).toContain("demo16.missing-widget");
		expect(diagnosticIds).toContain("demo16.missing-node");
	});

	it("preserves exact vessel schema and all three custom-node definitions", () => {
		const source = customLayoutTypesDemo.sources[0];
		const schema = source.schema as { required: string[]; properties: Record<string, Record<string, unknown>> };
		expect(Object.keys(schema.properties)).toEqual([
			"vesselName",
			"inspectorName",
			"inspectionDate",
			"hullCondition",
			"hullNotes",
			"engineStatus",
			"engineHours",
			"fuelLevel",
			"safetyEquipment",
			"fireExtinguishers",
			"lifeboats",
			"overallScore",
			"recommendation",
			"comments",
		]);
		expect(schema.required).toEqual(["vesselName", "inspectorName"]);
		expect(schema.properties.hullCondition.enum).toEqual(["Excellent", "Good", "Fair", "Poor", "Critical"]);
		expect(schema.properties.engineStatus.enum).toEqual(["Operational", "Needs Maintenance", "Out of Service"]);
		expect(schema.properties.recommendation.enum).toEqual(["Approved", "Conditional", "Rejected"]);
		expect(schema.properties.engineHours).toMatchObject({ minimum: 0, maximum: 100000 });
		expect(schema.properties.fuelLevel).toMatchObject({ minimum: 0, maximum: 100 });
		expect(schema.properties.overallScore).toMatchObject({ minimum: 1, maximum: 10 });
		expect(customLayoutTypesDemo.copy).toBe(
			"The same vessel inspection schema rendered via three different LayoutNode JSON trees: sections (group), tabs, and accordion. The layout JSON drives the rendering — swap the tree, change the UX.",
		);
		expect(customLayoutDefinitionVariants.map((variant) => variant.key)).toEqual(["sections", "tabs", "accordion"]);
		for (const variant of customLayoutDefinitionVariants) {
			const result = compile(source.schema, variant.definition);
			const nodes = allNodes(result.definition.root);
			expect(result.diagnostics.definition, variant.key).toEqual([]);
			expect(
				nodes.filter((node) => node.type === "field"),
				variant.key,
			).toHaveLength(14);
			expect(
				nodes.filter((node) => node.type === "custom" && node.renderer === "demo17.inspection-panel"),
			).toHaveLength(1);
			expect(nodes.filter((node) => node.type === "custom" && node.renderer === "demo17.field-grid")).toHaveLength(5);
		}
		expect(
			allNodes(customLayoutDefinitionVariants[0].definition.root)
				.filter((node) => node.type === "section")
				.map((node) => node.title),
		).toEqual(["General Information", "Hull Inspection", "Engine & Fuel", "Safety Equipment", "Summary"]);
	});

	it("retains one host/store/renderer path and server-renders both fixtures", () => {
		expect(hostSource.match(/useSchemaForm/g)).toHaveLength(2);
		expect(hostSource.match(/<FormRenderer/g)).toHaveLength(1);
		expect(hostSource).toContain("extensions={runtimeProfile?.extensions}");
		expect(hostSource).toContain("key={`${fixture.id}:${source.key}`}");
		for (const fixture of [customRenderersDemo, customLayoutTypesDemo]) {
			const html = serverRender(fixture);
			expect(html).toContain("data-formbar-definition");
			expect(html).not.toContain("data-formbar-diagnostic");
		}
	});
});
