import type { FormDefinition, FormNode } from "@formbar/declarative";
import type { SchemaDemoFixture } from "./baseline-contracts";

function field(id: string, name: string, widget: string, label: string, span: 4 | 6 | 8 | 12): FormNode {
	return {
		type: "field",
		id,
		binding: { namespace: "data", segments: [name] },
		widget,
		label,
		presentation: { span: { base: "full", md: span } },
	};
}

const definition = {
	version: 1,
	id: "vessel-layout",
	root: {
		type: "group",
		id: "vessel-root",
		children: [
			{
				type: "section",
				id: "vessel-identity",
				title: "Identity",
				children: [
					field("vessel-name", "name", "text", "Vessel name", 8),
					field("vessel-year", "year", "number", "Build year", 4),
				],
			},
			{
				type: "section",
				id: "vessel-classification",
				title: "Classification",
				children: [
					field("vessel-type", "vesselType", "select", "Vessel type", 6),
					field("vessel-flag", "flag", "select", "Flag", 6),
				],
			},
			{
				type: "section",
				id: "vessel-dimensions",
				title: "Dimensions",
				children: [
					field("vessel-length", "length", "number", "Length (m)", 4),
					field("vessel-beam", "beam", "number", "Beam (m)", 4),
					field("vessel-draft", "draft", "number", "Draft (m)", 4),
				],
			},
		],
	},
} satisfies FormDefinition;

export const customLayoutDemo = {
	id: "custom-layout",
	title: "9. Custom layout",
	subtitle: "Authored vessel field arrangement",
	copy: "One flat domain schema is arranged into Identity, Classification, and Dimensions by FormDefinition v1.",
	category: "layout",
	sources: [
		{
			key: "default",
			label: "Vessel schema",
			schema: {
				type: "object",
				properties: {
					name: { type: "string", title: "Vessel name" },
					year: { type: "integer", title: "Build year", minimum: 1800, maximum: 2100 },
					vesselType: { title: "Vessel type", enum: ["Cargo", "Passenger", "Research", "Sailing"] },
					flag: { title: "Flag", enum: ["Australia", "Japan", "Norway", "United Kingdom"] },
					length: { type: "number", title: "Length (m)", minimum: 0, maximum: 500 },
					beam: { type: "number", title: "Beam (m)", minimum: 0, maximum: 100 },
					draft: { type: "number", title: "Draft (m)", minimum: 0, maximum: 30 },
				},
				required: ["name", "vesselType", "flag"],
			},
			definition,
			initialData: {
				name: "Endeavour",
				year: 1994,
				vesselType: "Research",
				flag: "Australia",
				length: 73,
				beam: 16,
				draft: 5.5,
			},
		},
	],
} as const satisfies SchemaDemoFixture;
