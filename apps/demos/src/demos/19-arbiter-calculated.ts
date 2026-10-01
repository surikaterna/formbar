import type { ArbiterPluginOptions } from "@formbar/arbiter";
import type { DefinitionProgram as Expression, FormDefinition, FormNode } from "@formbar/declarative";
import type { SchemaDemoFixture } from "./baseline-contracts";
import { dataRef, literal, numeric, uiRef } from "./kalada-fixture-programs";

function field(id: string, path: string, label: string): Extract<FormNode, { type: "field" }> {
	return { type: "field", id, binding: { namespace: "data", segments: [path] }, widget: "number", label };
}

function output(id: string, label: string, value: Expression, format: "plain" | "currency-usd"): FormNode {
	return { type: "output", id, label, value, format };
}

const subtotal = numeric("multiply", dataRef("quantity"), dataRef("unitPrice"));
const discount = numeric("multiply", subtotal, literal(0.1));
const discountedTotal = numeric("subtract", subtotal, discount);
const showDiscount = uiRef("showBulkDiscount");

export const arbiterCalculatedRules = [
	{
		name: "smallOrder",
		when: { quantity: { $lt: 10 } },
		// biome-ignore lint/suspicious/noThenProperty: This is serialized Arbitre rule data.
		then: [{ $set: { "$ui.tier": "small", "$ui.showBulkDiscount": false } }],
	},
	{
		name: "bulkOrder",
		when: { quantity: { $gte: 10 } },
		// biome-ignore lint/suspicious/noThenProperty: This is serialized Arbitre rule data.
		then: [{ $set: { "$ui.tier": "bulk", "$ui.showBulkDiscount": true } }],
	},
] satisfies NonNullable<ArbiterPluginOptions["rules"]>;

export const arbiterCalculatedSchema = {
	type: "object",
	properties: {
		quantity: { type: "number", title: "Quantity", minimum: 1 },
		unitPrice: { type: "number", title: "Unit Price" },
	},
} as const;

export const arbiterCalculatedData = { quantity: 1, unitPrice: 25 } as const;
export const arbiterCalculatedUiState = { tier: "small", showBulkDiscount: false } as const;

export const arbiterCalculatedDefinition = {
	version: 1,
	id: "arbiter-calculated",
	root: {
		type: "section",
		id: "order-form",
		title: "Order Form",
		children: [
			field("f-quantity", "quantity", "Quantity"),
			{
				...field("f-unit-price", "unitPrice", "Unit Price ($)"),
				widget: "demo19.numeric-presentation",
				props: { min: { mode: "literal", value: 0 }, step: { mode: "literal", value: 0.01 } },
			},
			output("tier", "Tier", uiRef("tier"), "plain"),
			output("subtotal-output", "Subtotal", subtotal, "currency-usd"),
			{
				type: "conditional",
				id: "bulk-pricing",
				condition: showDiscount,
				// biome-ignore lint/suspicious/noThenProperty: This is serialized FormDefinition branch data.
				then: [
					output("bulk-discount", "Bulk Discount (10%)", discount, "currency-usd"),
					output("bulk-total", "Total", discountedTotal, "currency-usd"),
				],
				else: [output("small-total", "Total", subtotal, "currency-usd")],
			},
		],
	},
} satisfies FormDefinition;

export const arbiterCalculatedDemo = {
	id: "arbiter-calculated",
	title: "19. Arbiter: Calculated Fields",
	subtitle: "Tier detection and pure calculated outputs",
	copy: "Rules handle conditional logic (tier detection, discount eligibility) while derived arithmetic is computed in pure OutputNode expressions. This separates concerns: rules for conditions, expressions for math.",
	category: "conditional",
	runtimeProfileIds: ["demo19.numeric-presentation.v1"],
	actionControls: "definition",
	sources: [
		{
			key: "default",
			label: "Calculated order schema",
			schema: arbiterCalculatedSchema,
			definition: arbiterCalculatedDefinition,
			initialData: arbiterCalculatedData,
			initialUiState: arbiterCalculatedUiState,
			arbiterRules: arbiterCalculatedRules,
		},
	],
} as const satisfies SchemaDemoFixture;
