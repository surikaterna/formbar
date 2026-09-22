import type { ArbiterPluginOptions } from "@formbar/arbiter";
import type { Expression, FormDefinition, FormNode } from "@formbar/declarative";
import type { SchemaDemoFixture } from "./baseline-contracts";

type ArbiterRule = NonNullable<ArbiterPluginOptions["rules"]>[number];
const required = (path: string, value: boolean) => ({ path: `/${path}`, required: value });

function policyRule(name: string, coverageType: string, entries: Record<string, unknown>): ArbiterRule {
	return {
		name,
		when: { coverageType },
		// biome-ignore lint/suspicious/noThenProperty: This is serialized Arbitre rule data.
		then: [{ $set: entries }],
	};
}

export const arbiterSectionsRules = [
	policyRule("requireAutoDetails", "auto", {
		"$formbar.fieldPolicy.make": required("make", true),
		"$formbar.fieldPolicy.model": required("model", true),
		"$formbar.fieldPolicy.year": required("year", true),
		"$formbar.fieldPolicy.address": required("address", false),
		"$formbar.fieldPolicy.sqft": required("sqft", false),
		"$formbar.fieldPolicy.yearBuilt": required("yearBuilt", false),
		"$formbar.fieldPolicy.age": required("age", false),
		"$formbar.fieldPolicy.smoker": required("smoker", false),
		"$formbar.fieldPolicy.conditions": required("conditions", false),
	}),
	policyRule("requireHomeDetails", "home", {
		"$formbar.fieldPolicy.make": required("make", false),
		"$formbar.fieldPolicy.model": required("model", false),
		"$formbar.fieldPolicy.year": required("year", false),
		"$formbar.fieldPolicy.address": required("address", true),
		"$formbar.fieldPolicy.sqft": required("sqft", true),
		"$formbar.fieldPolicy.yearBuilt": required("yearBuilt", true),
		"$formbar.fieldPolicy.age": required("age", false),
		"$formbar.fieldPolicy.smoker": required("smoker", false),
		"$formbar.fieldPolicy.conditions": required("conditions", false),
	}),
	policyRule("requireLifeDetails", "life", {
		"$formbar.fieldPolicy.make": required("make", false),
		"$formbar.fieldPolicy.model": required("model", false),
		"$formbar.fieldPolicy.year": required("year", false),
		"$formbar.fieldPolicy.address": required("address", false),
		"$formbar.fieldPolicy.sqft": required("sqft", false),
		"$formbar.fieldPolicy.yearBuilt": required("yearBuilt", false),
		"$formbar.fieldPolicy.age": required("age", true),
		"$formbar.fieldPolicy.smoker": required("smoker", true),
		"$formbar.fieldPolicy.conditions": required("conditions", true),
	}),
] satisfies NonNullable<ArbiterPluginOptions["rules"]>;

const coverageRef = { kind: "ref", ref: { namespace: "data", segments: ["coverageType"] } } as const;
const binding = (path: string) => ({ namespace: "data" as const, segments: [path] });

function field(id: string, path: string, widget: string, label: string, placeholder?: string): FormNode {
	return {
		type: "field",
		id,
		binding: binding(path),
		widget,
		label,
		...(placeholder ? { props: { placeholder: { mode: "literal" as const, value: placeholder } } } : {}),
	};
}

function sectionBranch(id: string, coverageType: string, title: string, children: readonly FormNode[]): FormNode {
	const condition: Expression = {
		kind: "op",
		op: "eq",
		args: [coverageRef, { kind: "literal", value: coverageType }],
	};
	return {
		type: "conditional",
		id,
		condition,
		// biome-ignore lint/suspicious/noThenProperty: This is serialized FormDefinition branch data.
		then: [{ type: "section", id: `${id}-section`, title, children }],
	};
}

export const arbiterSectionsDefinition = {
	version: 1,
	id: "arbiter-dynamic-sections",
	root: {
		type: "group",
		id: "root",
		children: [
			field("f-coverage-type", "coverageType", "select", "Coverage Type"),
			{
				type: "conditional",
				id: "when-coverage-selected",
				condition: { kind: "op", op: "exists", args: [coverageRef] },
				// biome-ignore lint/suspicious/noThenProperty: This is serialized FormDefinition branch data.
				then: [
					sectionBranch("when-auto", "auto", "Vehicle Information", [
						field("f-make", "make", "text", "Make"),
						field("f-model", "model", "text", "Model"),
						field("f-year", "year", "number", "Year"),
					]),
					sectionBranch("when-home", "home", "Property Information", [
						field("f-address", "address", "text", "Address"),
						field("f-sqft", "sqft", "number", "Square Footage"),
						field("f-year-built", "yearBuilt", "number", "Year Built"),
					]),
					sectionBranch("when-life", "life", "Health Information", [
						field("f-age", "age", "number", "Age"),
						field("f-smoker", "smoker", "checkbox", "Smoker"),
						field("f-conditions", "conditions", "text", "Pre-existing Conditions", "None, or describe..."),
					]),
				],
			},
		],
	},
} satisfies FormDefinition;

export const arbiterSectionsSchema = {
	type: "object",
	properties: {
		coverageType: { type: "string", title: "Coverage Type", enum: ["auto", "home", "life"] },
		make: { type: "string", title: "Make" },
		model: { type: "string", title: "Model" },
		year: { type: "number", title: "Year" },
		address: { type: "string", title: "Address" },
		sqft: { type: "number", title: "Square Footage" },
		yearBuilt: { type: "number", title: "Year Built" },
		age: { type: "number", title: "Age" },
		smoker: { type: "boolean", title: "Smoker" },
		conditions: { type: "string", title: "Pre-existing Conditions" },
	},
} as const;

export const arbiterSectionsData = {
	make: "",
	model: "",
	year: 0,
	address: "",
	sqft: 0,
	yearBuilt: 0,
	age: 0,
	smoker: false,
	conditions: "",
} as const;

export const arbiterDynamicSectionsDemo = {
	id: "arbiter-dynamic-sections",
	title: "21. Arbiter: Dynamic Sections",
	subtitle: "Native sections with projected required cues",
	copy: "Native conditions own insurance section structure. Arbiter only projects required presentation for the selected section; schema and explicit validators remain validation authority.",
	category: "conditional",
	sources: [
		{
			key: "default",
			label: "Insurance coverage schema",
			schema: arbiterSectionsSchema,
			definition: arbiterSectionsDefinition,
			initialData: arbiterSectionsData,
			arbiterRules: arbiterSectionsRules,
		},
	],
} as const satisfies SchemaDemoFixture;
