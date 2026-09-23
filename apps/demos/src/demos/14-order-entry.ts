import { orderEntryDefinition } from "./14-order-entry-definition";
import type { SchemaDemoFixture } from "./baseline-contracts";

export const orderEntrySchema = {
	type: "object",
	required: ["customerName", "orderDate", "paymentMethod", "lineItems"],
	properties: {
		orderNumber: { type: "string", title: "Order Number", description: "Auto-generated if left blank" },
		customerName: { type: "string", title: "Customer Name" },
		customerEmail: { type: "string", title: "Customer Email", format: "email" },
		orderDate: { type: "string", title: "Order Date", description: "YYYY-MM-DD format", format: "date" },
		deliveryDate: { type: "string", title: "Requested Delivery Date", format: "date" },
		paymentMethod: {
			type: "string",
			title: "Payment Method",
			enum: ["Credit Card", "Wire Transfer", "Purchase Order", "Net 30", "Net 60"],
		},
		currency: { type: "string", title: "Currency", enum: ["USD", "EUR", "GBP", "JPY", "NOK", "SEK", "DKK", "CHF"] },
		lineItems: {
			type: "array",
			title: "Line Items",
			minItems: 1,
			maxItems: 20,
			items: {
				type: "object",
				required: ["description", "amount"],
				properties: {
					description: { type: "string", title: "Description", minLength: 1 },
					amount: { type: "number", title: "Amount", minimum: 0 },
				},
			},
		},
		taxRate: { type: "number", title: "Tax Rate (%)", minimum: 0, maximum: 100 },
		discount: { type: "number", title: "Discount (%)", minimum: 0, maximum: 100 },
		shippingCost: { type: "number", title: "Shipping Cost", minimum: 0 },
		notes: {
			type: "string",
			title: "Order Notes",
			"x-formbar": { widget: "textarea" },
			description: "Internal notes for this order",
		},
		rushOrder: { type: "boolean", title: "Rush Order", description: "Prioritize processing" },
		requiresSignature: {
			type: "boolean",
			title: "Requires Signature",
			description: "Delivery must be signed for",
		},
	},
} as const;

export const orderEntryData = { lineItems: [] } as const;

export const orderEntryDemo = {
	id: "order-entry",
	title: "14. Order / Invoice Entry",
	subtitle: "Invoice with line items and pure totals",
	copy: "A real-world order entry form with multiple sections for header, customer, payment, and delivery details. Demonstrates formbar handling business forms with mixed field types. Displayed calculations are ephemeral and omitted from submission pending #129.",
	category: "sources",
	actionControls: "definition",
	sources: [
		{
			key: "default",
			label: "Order entry schema",
			schema: orderEntrySchema,
			definition: orderEntryDefinition,
			initialData: orderEntryData,
		},
	],
} as const satisfies SchemaDemoFixture;
