import type { FormDefinition, FormNode } from "@formbar/declarative";
import type { SchemaDemoFixture } from "./baseline-contracts";

function field(id: string, name: string, widget: string, label: string, span: 4 | 6 | 8 | 12 = 6): FormNode {
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
	id: "product-entry",
	root: {
		type: "group",
		id: "product-root",
		children: [
			{
				type: "section",
				id: "product-details",
				title: "Product details",
				children: [
					field("product-name", "name", "text", "Product name", 8),
					field("product-category", "category", "select", "Category", 4),
					field("product-description", "description", "textarea", "Description", 12),
				],
			},
			{
				type: "section",
				id: "product-inventory",
				title: "Pricing and inventory",
				children: [
					field("product-price", "price", "number", "Price", 4),
					field("product-weight", "weight", "number", "Weight (kg)", 4),
					field("product-quantity", "quantity", "number", "Quantity", 4),
					field("product-rating", "rating", "number", "Rating", 4),
				],
			},
		],
	},
} satisfies FormDefinition;

export const productEntryDemo = {
	id: "product-entry",
	title: "5. Product entry",
	subtitle: "Schema-owned product constraints",
	copy: "Category options, required fields, and numeric bounds come from descriptor evidence.",
	category: "baseline",
	sources: [
		{
			key: "default",
			label: "Product schema",
			schema: {
				type: "object",
				properties: {
					name: { type: "string", title: "Product name", minLength: 2 },
					category: { title: "Category", enum: ["Books", "Electronics", "Home", "Outdoors"] },
					description: { type: "string", title: "Description", maxLength: 1000, "x-formbar": { widget: "textarea" } },
					price: { type: "number", title: "Price", minimum: 0 },
					weight: { type: "number", title: "Weight (kg)", minimum: 0, maximum: 1000 },
					quantity: { type: "integer", title: "Quantity", minimum: 0, maximum: 10000 },
					rating: { type: "integer", title: "Rating", minimum: 1, maximum: 5 },
				},
				required: ["name", "category", "price", "quantity"],
			},
			definition,
			initialData: {
				name: "Field notebook",
				category: "Books",
				description: "A durable notebook for field notes.",
				price: 12.5,
				weight: 0.4,
				quantity: 25,
				rating: 5,
			},
		},
	],
} as const satisfies SchemaDemoFixture;
