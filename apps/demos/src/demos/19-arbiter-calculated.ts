import type { ArbiterPluginOptions } from "@formbar/arbiter";
import type { Expression, FormDefinition, FormNode } from "@formbar/declarative";
import type { SchemaDemoFixture } from "./baseline-contracts";

const dataRef = (path: string): Expression => ({ kind: "ref", ref: { namespace: "data", segments: [path] } });
const uiRef = (path: string): Expression => ({ kind: "ref", ref: { namespace: "ui", segments: [path] } });
const literal = (value: string | number): Expression => ({ kind: "literal", value });
const operation = (op: string, ...args: Expression[]): Expression => ({ kind: "op", op, args });

function field(id: string, path: string, label: string): FormNode {
	return { type: "field", id, binding: { namespace: "data", segments: [path] }, widget: "number", label };
}

function output(id: string, label: string, value: Expression, format: "plain" | "currency-usd"): FormNode {
	return { type: "output", id, label, value, format };
}

const subtotal = operation("mul", dataRef("quantity"), dataRef("unitPrice"));
const discount = operation("mul", subtotal, literal(0.1));
const discountedTotal = operation("sub", subtotal, discount);
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
			field("f-unit-price", "unitPrice", "Unit Price ($)"),
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
