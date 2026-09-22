import type { FormDefinition, FormNode } from "@formbar/declarative";
import type { SchemaDemoFixture } from "./baseline-contracts";

const countries = [
	"United States",
	"Canada",
	"United Kingdom",
	"Germany",
	"France",
	"Australia",
	"Japan",
	"Other",
] as const;

const address = (title: string) => ({
	type: "object",
	title,
	properties: {
		street: { type: "string", title: "Street" },
		city: { type: "string", title: "City" },
		state: { type: "string", title: "State/Province" },
		zipCode: { type: "string", title: "Zip/Postal Code" },
		country: { type: "string", title: "Country", enum: countries },
	},
});

function field(id: string, path: readonly string[], widget: string, label: string): FormNode {
	return { type: "field", id, binding: { namespace: "data", segments: path }, widget, label };
}

function addressSection(id: string, path: string, title: string): FormNode {
	return {
		type: "section",
		id,
		title,
		children: [
			field(`${id}-street`, [path, "street"], "text", "Street"),
			field(`${id}-city`, [path, "city"], "text", "City"),
			field(`${id}-state`, [path, "state"], "text", "State/Province"),
			field(`${id}-zip`, [path, "zipCode"], "text", "Zip/Postal Code"),
			field(`${id}-country`, [path, "country"], "select", "Country"),
		],
	};
}

const definition = {
	version: 1,
	id: "nested-address",
	root: {
		type: "group",
		id: "root",
		children: [
			field("f-name", ["name"], "text", "Full Name"),
			field("f-email", ["email"], "email", "Email"),
			addressSection("home-address", "homeAddress", "Home Address"),
			addressSection("work-address", "workAddress", "Work Address"),
		],
	},
} satisfies FormDefinition;

export const nestedAddressDemo = {
	id: "nested-address",
	title: "3. Nested Address Form",
	subtitle: "Generated nested sections",
	copy: "Auto-generated layout groups the original nested home and work address objects.",
	category: "baseline",
	sources: [
		{
			key: "default",
			label: "Address schema",
			schema: {
				type: "object",
				required: ["name", "email"],
				properties: {
					name: { type: "string", title: "Full Name" },
					email: { type: "string", title: "Email", format: "email" },
					homeAddress: address("Home Address"),
					workAddress: address("Work Address"),
				},
			},
			definition,
			initialData: {},
		},
	],
} as const satisfies SchemaDemoFixture;
