import type { SchemaDemoFixture } from "./baseline-contracts";

export const basicContactDemo = {
	id: "basic-contact",
	title: "1. Basic contact",
	subtitle: "Generated contact form",
	copy: "A JSON Schema generates the definition, labels, native controls, and required state.",
	category: "baseline",
	sources: [
		{
			key: "default",
			label: "Contact schema",
			schema: {
				type: "object",
				title: "Contact",
				description: "Tell us how to reach you.",
				properties: {
					name: { type: "string", title: "Name", minLength: 1 },
					email: { type: "string", title: "Email", format: "email" },
					phone: { type: "string", title: "Phone", format: "tel" },
					message: {
						type: "string",
						title: "Message",
						maxLength: 500,
						"x-formbar": { widget: "textarea", placeholder: "How can we help?" },
					},
				},
				required: ["name", "email"],
			},
			initialData: { name: "", email: "", phone: "", message: "" },
		},
	],
} as const satisfies SchemaDemoFixture;
