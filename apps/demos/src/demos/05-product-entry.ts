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
	id: "product-entry",
	root: {
		type: "group",
		id: "root",
		children: [
			{
				type: "section",
				id: "identity",
				title: "Product Identity",
				children: [
					field("f-name", "name", "text", "Product Name", "Display name shown to customers", half),
					field("f-sku", "sku", "text", "SKU", "Stock Keeping Unit identifier", half),
					field("f-category", "category", "select", "Category", undefined, half),
				],
			},
			{
				type: "section",
				id: "details",
				title: "Details",
				children: [field("f-description", "description", "textarea", "Description", "Detailed product description")],
			},
			{
				type: "section",
				id: "pricing",
				title: "Pricing & Inventory",
				children: [
					field("f-price", "price", "number", "Price (USD)", "Retail price", half),
					field("f-weight", "weight", "number", "Weight (kg)", "Shipping weight", half),
					field("f-quantity", "quantity", "number", "Stock Quantity", "Units in stock", half),
					field("f-rating", "rating", "number", "Quality Rating", "Internal quality score", half),
				],
			},
			{
				type: "section",
				id: "status",
				title: "Status",
				children: [
					field("f-isActive", "isActive", "checkbox", "Active", "Available for purchase", half),
					field("f-isFeatured", "isFeatured", "checkbox", "Featured", "Show on homepage", half),
				],
			},
		],
	},
} satisfies FormDefinition;

export const productEntryDemo = {
	id: "product-entry",
	title: "5. Product Catalog Entry",
	subtitle: "Schema-owned product constraints",
	copy: "The original product catalog fields retain their constraints, descriptions, category order, inventory, and status controls.",
	category: "baseline",
	sources: [
		{
			key: "default",
			label: "Product schema",
			schema: {
				type: "object",
				required: ["name", "sku", "price", "category"],
				properties: {
					name: { type: "string", title: "Product Name", description: "Display name shown to customers" },
					sku: { type: "string", title: "SKU", description: "Stock Keeping Unit identifier" },
					description: {
						type: "string",
						title: "Description",
						maxLength: 1000,
						description: "Detailed product description",
						"x-formbar": { widget: "textarea" },
					},
					category: {
						type: "string",
						title: "Category",
						enum: [
							"Electronics",
							"Clothing",
							"Home & Garden",
							"Sports",
							"Books",
							"Food & Beverage",
							"Health",
							"Automotive",
							"Toys",
							"Office Supplies",
						],
					},
					price: { type: "number", title: "Price (USD)", minimum: 0, description: "Retail price" },
					weight: { type: "number", title: "Weight (kg)", minimum: 0, description: "Shipping weight" },
					quantity: {
						type: "integer",
						title: "Stock Quantity",
						minimum: 0,
						maximum: 10000,
						description: "Units in stock",
					},
					rating: {
						type: "integer",
						title: "Quality Rating",
						minimum: 1,
						maximum: 5,
						description: "Internal quality score",
					},
					isActive: { type: "boolean", title: "Active", description: "Available for purchase" },
					isFeatured: { type: "boolean", title: "Featured", description: "Show on homepage" },
				},
			},
			definition,
			initialData: {},
		},
	],
} as const satisfies SchemaDemoFixture;
