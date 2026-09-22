import type { ArbiterPluginOptions } from "@formbar/arbiter";
import type { Expression, FormDefinition, FormNode } from "@formbar/declarative";
import type { SchemaDemoFixture } from "./baseline-contracts";

type ArbiterRule = NonNullable<ArbiterPluginOptions["rules"]>[number];

function policyRule(name: string, when: ArbiterRule["when"], entries: Record<string, unknown>): ArbiterRule {
	return {
		name,
		when,
		// biome-ignore lint/suspicious/noThenProperty: This is serialized Arbitre rule data.
		then: [{ $set: entries }],
	};
}

const regionalSnapshot = (state: boolean, province: boolean, region: boolean) => ({
	"$formbar.fieldPolicy.state": { path: "/state", visible: state },
	"$formbar.fieldPolicy.province": { path: "/province", visible: province },
	"$formbar.fieldPolicy.region": { path: "/region", visible: region },
});

export const arbiterVisibilityRules = [
	policyRule("showUSState", { country: "US" }, regionalSnapshot(true, false, false)),
	policyRule("showCAProvince", { country: "CA" }, regionalSnapshot(false, true, false)),
	policyRule("showOtherRegion", { country: { $in: ["UK", "DE"] } }, regionalSnapshot(false, false, true)),
] satisfies NonNullable<ArbiterPluginOptions["rules"]>;

const countryRef: Expression = { kind: "ref", ref: { namespace: "data", segments: ["country"] } };
const selectedCountry: Expression = {
	kind: "op",
	op: "and",
	args: [
		{ kind: "op", op: "exists", args: [countryRef] },
		{ kind: "op", op: "neq", args: [countryRef, { kind: "literal", value: "" }] },
	],
};

function field(id: string, path: string, widget: string, label: string): FormNode {
	return { type: "field", id, binding: { namespace: "data", segments: [path] }, widget, label };
}

export const arbiterVisibilityDefinition = {
	version: 1,
	id: "arbiter-visibility",
	root: {
		type: "group",
		id: "root",
		children: [
			field("f-country", "country", "select", "Country"),
			{
				type: "conditional",
				id: "when-country-selected",
				condition: selectedCountry,
				// biome-ignore lint/suspicious/noThenProperty: This is serialized FormDefinition branch data.
				then: [
					{
						type: "section",
						id: "regional-details",
						title: "Regional Details",
						children: [
							field("f-state", "state", "select", "State"),
							field("f-province", "province", "select", "Province"),
							field("f-region", "region", "text", "Region"),
						],
					},
				],
			},
		],
	},
} satisfies FormDefinition;

export const arbiterVisibilitySchema = {
	type: "object",
	properties: {
		country: { type: "string", title: "Country", enum: ["US", "CA", "UK", "DE"] },
		state: { type: "string", title: "State", enum: ["California", "New York", "Texas", "Florida"] },
		province: {
			type: "string",
			title: "Province",
			enum: ["Ontario", "Quebec", "British Columbia", "Alberta"],
		},
		region: { type: "string", title: "Region" },
	},
} as const;

export const arbiterVisibilityData = { region: "" } as const;

export const arbiterVisibilityDemo = {
	id: "arbiter-visibility",
	title: "18. Arbiter: Conditional Visibility",
	subtitle: "Normalized regional field policy",
	copy: "A native gate owns the empty country state. For a selected country, Arbiter alone projects the complete regional visibility policy and releases stale policy on clear.",
	category: "conditional",
	sources: [
		{
			key: "default",
			label: "Regional visibility schema",
			schema: arbiterVisibilitySchema,
			definition: arbiterVisibilityDefinition,
			initialData: arbiterVisibilityData,
			arbiterRules: arbiterVisibilityRules,
		},
	],
} as const satisfies SchemaDemoFixture;
