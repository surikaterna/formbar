import type { FormDefinition, FormNode } from "@formbar/declarative";
import { customLayoutProfile } from "../extensions/custom-layout-profile";
import type { SchemaDemoDefinitionVariant, SchemaDemoFixture } from "./baseline-contracts";

const fieldSpecs = Object.freeze({
	vesselName: ["Vessel Name", "text"],
	inspectorName: ["Inspector Name", "text"],
	inspectionDate: ["Inspection Date", "text"],
	hullCondition: ["Hull Condition", "select"],
	hullNotes: ["Hull Notes", "textarea"],
	engineStatus: ["Engine Status", "select"],
	engineHours: ["Engine Hours", "number"],
	fuelLevel: ["Fuel Level (%)", "number"],
	safetyEquipment: ["Safety Equipment Present", "checkbox"],
	fireExtinguishers: ["Fire Extinguishers Inspected", "checkbox"],
	lifeboats: ["Lifeboats Operational", "checkbox"],
	overallScore: ["Overall Score", "number"],
	recommendation: ["Recommendation", "select"],
	comments: ["Comments", "textarea"],
} as const);

type FieldPath = keyof typeof fieldSpecs;

function fieldPaths(...paths: FieldPath[]): readonly FieldPath[] {
	return Object.freeze(paths);
}

const groups = Object.freeze([
	Object.freeze({
		id: "general",
		title: "General Information",
		tab: "General",
		fields: fieldPaths("vesselName", "inspectorName", "inspectionDate"),
	}),
	Object.freeze({
		id: "hull",
		title: "Hull Inspection",
		tab: "Hull",
		fields: fieldPaths("hullCondition", "hullNotes"),
	}),
	Object.freeze({
		id: "engine",
		title: "Engine & Fuel",
		tab: "Engine",
		fields: fieldPaths("engineStatus", "engineHours", "fuelLevel"),
	}),
	Object.freeze({
		id: "safety",
		title: "Safety Equipment",
		tab: "Safety",
		fields: fieldPaths("safetyEquipment", "fireExtinguishers", "lifeboats"),
	}),
	Object.freeze({
		id: "summary",
		title: "Summary",
		tab: "Summary",
		fields: fieldPaths("overallScore", "recommendation", "comments"),
	}),
]);

function literal(value: string | number) {
	return { mode: "literal" as const, value };
}

function fields(paths: readonly FieldPath[]): readonly FormNode[] {
	return paths.map((path) => {
		const [label, widget] = fieldSpecs[path];
		return { type: "field", id: `f-${path}`, binding: { namespace: "data", segments: [path] }, widget, label };
	});
}

function grid(id: string, paths: readonly FieldPath[]): FormNode {
	return {
		type: "custom",
		id: `grid-${id}`,
		renderer: "demo17.field-grid",
		props: { columns: literal(2) },
		children: fields(paths),
	};
}

function panel(childNodes: readonly FormNode[]): FormNode {
	return {
		type: "custom",
		id: "inspection-panel",
		renderer: "demo17.inspection-panel",
		props: { title: literal("Vessel Inspection") },
		children: childNodes,
	};
}

function definition(id: string, root: FormNode): FormDefinition {
	return { version: 1, id, root };
}

const sections = definition(
	"demo17-sections",
	panel(
		groups.map((group) => ({
			type: "section",
			id: `section-${group.id}`,
			title: group.title,
			children: [grid(group.id, group.fields)],
		})),
	),
);

const tabs = definition(
	"demo17-tabs",
	panel([
		{
			type: "tabs",
			id: "inspection-tabs",
			tabs: groups.map((group) => ({
				id: `tab-${group.id}`,
				label: group.tab,
				children: [grid(group.id, group.fields)],
			})),
		},
	]),
);

const accordion = definition(
	"demo17-accordion",
	panel([
		{
			type: "accordion",
			id: "inspection-accordion",
			items: groups.map((group) => ({
				id: `item-${group.id}`,
				label: group.title,
				children: [grid(group.id, group.fields)],
			})),
		},
	]),
);

export const customLayoutDefinitionVariants: readonly [SchemaDemoDefinitionVariant, ...SchemaDemoDefinitionVariant[]] =
	Object.freeze([
		Object.freeze({ key: "sections", label: "Sections", definition: sections }),
		Object.freeze({ key: "tabs", label: "Tabs", definition: tabs }),
		Object.freeze({ key: "accordion", label: "Accordion", definition: accordion }),
	]);

export const customLayoutTypesDemo: SchemaDemoFixture = Object.freeze({
	id: "custom-layout-types",
	title: "17. Custom Layout Types",
	subtitle: "One schema through sections, tabs, and accordion",
	copy: "The same vessel inspection schema rendered via three different LayoutNode JSON trees: sections (group), tabs, and accordion. The layout JSON drives the rendering — swap the tree, change the UX.",
	category: "layout",
	runtimeProfile: customLayoutProfile,
	sources: Object.freeze([
		Object.freeze({
			key: "vessel-inspection",
			label: "Vessel inspection schema",
			schema: Object.freeze({
				type: "object",
				required: ["vesselName", "inspectorName"],
				properties: {
					vesselName: { type: "string", title: "Vessel Name" },
					inspectorName: { type: "string", title: "Inspector Name" },
					inspectionDate: { type: "string", title: "Inspection Date" },
					hullCondition: {
						type: "string",
						title: "Hull Condition",
						enum: ["Excellent", "Good", "Fair", "Poor", "Critical"],
					},
					hullNotes: { type: "string", title: "Hull Notes", "x-formbar": { widget: "textarea" } },
					engineStatus: {
						type: "string",
						title: "Engine Status",
						enum: ["Operational", "Needs Maintenance", "Out of Service"],
					},
					engineHours: { type: "integer", title: "Engine Hours", minimum: 0, maximum: 100000 },
					fuelLevel: { type: "integer", title: "Fuel Level (%)", minimum: 0, maximum: 100 },
					safetyEquipment: { type: "boolean", title: "Safety Equipment Present" },
					fireExtinguishers: { type: "boolean", title: "Fire Extinguishers Inspected" },
					lifeboats: { type: "boolean", title: "Lifeboats Operational" },
					overallScore: { type: "integer", title: "Overall Score", minimum: 1, maximum: 10 },
					recommendation: {
						type: "string",
						title: "Recommendation",
						enum: ["Approved", "Conditional", "Rejected"],
					},
					comments: { type: "string", title: "Comments", "x-formbar": { widget: "textarea" } },
				},
			}),
			definitionVariants: customLayoutDefinitionVariants,
			initialData: Object.freeze({}),
		}),
	] as const),
});
