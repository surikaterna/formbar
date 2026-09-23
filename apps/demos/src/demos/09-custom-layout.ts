import type { FormDefinition, FormNode, ResponsiveSpan } from "@formbar/declarative";
import type { SchemaDemoFixture } from "./baseline-contracts";

function field(
	id: string,
	path: string,
	widget: string,
	label: string,
	description?: string,
	span?: ResponsiveSpan,
): FormNode {
	return {
		type: "field",
		id,
		binding: { namespace: "data", segments: [path] },
		widget,
		label,
		...(description ? { props: { description: { mode: "literal" as const, value: description } } } : {}),
		...(span ? { presentation: { span } } : {}),
	};
}

const half = { base: "full", md: 6 } as const;
const definition = {
	version: 1,
	id: "custom-layout",
	root: {
		type: "group",
		id: "root",
		children: [
			{
				type: "section",
				id: "identity",
				title: "Vessel Identity",
				children: [
					field("f-name", "vesselName", "text", "Vessel Name", undefined, half),
					field("f-imo", "imoNumber", "text", "IMO Number", "International Maritime Organization number", half),
					field("f-callSign", "callSign", "text", "Call Sign", undefined, half),
					field("f-flag", "flag", "select", "Flag State", undefined, half),
				],
			},
			{
				type: "section",
				id: "classification",
				title: "Classification",
				children: [
					field("f-type", "vesselType", "radio", "Vessel Type", undefined, half),
					field("f-year", "yearBuilt", "demo16.range", "Year Built", undefined, half),
					field("f-active", "isActive", "checkbox", "Active", "Currently in service", half),
				],
			},
			{
				type: "section",
				id: "dimensions",
				title: "Dimensions & Capacity",
				children: [
					field("f-gt", "grossTonnage", "number", "Gross Tonnage", "GT", half),
					field("f-dwt", "deadweight", "number", "Deadweight", "DWT in metric tons", half),
					field("f-loa", "length", "number", "LOA (m)", "Length Overall in meters", half),
					field("f-beam", "beam", "number", "Beam (m)", "Width at widest point", half),
					field("f-draft", "draft", "number", "Max Draft (m)", "Maximum draft", half),
				],
			},
		],
	},
} satisfies FormDefinition;

export const customLayoutDemo = {
	id: "custom-layout",
	title: "9. Custom Layout Override",
	subtitle: "Authored vessel field arrangement",
	copy: "The original flat vessel schema is arranged into identity, classification, and dimensions without app-owned layout rendering.",
	category: "layout",
	runtimeProfileIds: ["demo16.trusted-widgets.v1"],
	sources: [
		{
			key: "default",
			label: "Vessel schema",
			schema: {
				type: "object",
				required: ["vesselName", "imoNumber"],
				properties: {
					vesselName: { type: "string", title: "Vessel Name" },
					imoNumber: {
						type: "string",
						title: "IMO Number",
						description: "International Maritime Organization number",
					},
					callSign: { type: "string", title: "Call Sign" },
					flag: {
						type: "string",
						title: "Flag State",
						enum: [
							"Panama",
							"Liberia",
							"Marshall Islands",
							"Hong Kong",
							"Singapore",
							"Bahamas",
							"Malta",
							"Norway",
							"Greece",
							"Japan",
						],
					},
					vesselType: {
						type: "string",
						title: "Vessel Type",
						enum: ["Container", "Bulk Carrier", "Tanker", "RoRo", "General Cargo"],
					},
					grossTonnage: { type: "number", title: "Gross Tonnage", minimum: 0, description: "GT" },
					deadweight: { type: "number", title: "Deadweight", minimum: 0, description: "DWT in metric tons" },
					length: { type: "number", title: "LOA (m)", minimum: 0, description: "Length Overall in meters" },
					beam: { type: "number", title: "Beam (m)", minimum: 0, description: "Width at widest point" },
					draft: { type: "number", title: "Max Draft (m)", minimum: 0, description: "Maximum draft" },
					yearBuilt: { type: "integer", title: "Year Built", minimum: 1950, maximum: 2026 },
					isActive: { type: "boolean", title: "Active", description: "Currently in service" },
				},
			},
			definition,
			initialData: {},
		},
	],
} as const satisfies SchemaDemoFixture;
