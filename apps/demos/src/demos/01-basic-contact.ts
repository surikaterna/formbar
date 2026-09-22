import type { SchemaDemoFixture } from "./baseline-contracts";

export const basicContactDemo = {
	id: "basic-contact",
	title: "1. Basic Contact Form",
	subtitle: "Generated contact form",
	copy: "Simple contact form with text, email, and textarea fields. Auto-generated layout from JSON Schema.",
	category: "baseline",
	sources: [
		{
			key: "default",
			label: "Contact schema",
			schema: {
				type: "object",
				required: ["name", "email"],
				properties: {
					name: { type: "string", title: "Full Name", description: "Your full legal name" },
					email: {
						type: "string",
						title: "Email",
						format: "email",
						description: "We will never share your email",
					},
					phone: { type: "string", title: "Phone Number" },
					message: {
						type: "string",
						title: "Message",
						maxLength: 500,
						"x-formbar": { widget: "textarea" },
					},
				},
			},
			initialData: {},
		},
	],
} as const satisfies SchemaDemoFixture;
