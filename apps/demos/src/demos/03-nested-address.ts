import type { SchemaDemoFixture } from "./baseline-contracts";

const address = (title: string) => ({
	type: "object",
	title,
	properties: {
		street: { type: "string", title: "Street" },
		city: { type: "string", title: "City" },
		postalCode: { type: "string", title: "Postal code" },
		country: { title: "Country", enum: ["Australia", "Japan", "United Kingdom", "United States"] },
	},
	required: ["street", "city", "country"],
});

export const nestedAddressDemo = {
	id: "nested-address",
	title: "3. Nested addresses",
	subtitle: "Generated nested sections",
	copy: "Titled nested objects compile into distinct home and work address sections.",
	category: "baseline",
	sources: [
		{
			key: "default",
			label: "Address schema",
			schema: {
				type: "object",
				title: "Addresses",
				properties: { homeAddress: address("Home address"), workAddress: address("Work address") },
				required: ["homeAddress"],
			},
			initialData: {
				homeAddress: { street: "1 Main Street", city: "London", postalCode: "SW1A", country: "United Kingdom" },
				workAddress: { street: "2 Market Street", city: "Tokyo", postalCode: "100-0001", country: "Japan" },
			},
		},
	],
} as const satisfies SchemaDemoFixture;
