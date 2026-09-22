import type { SchemaDemoFixture } from "./baseline-contracts";

export const basicContactDemo = {
	id: "basic-contact",
	title: "1. Basic Contact Form",
	subtitle: "Generated contact form",
	copy: "JSON Schema requires name and email properties; minLength separately makes the present name non-empty, and email format is asserted during core submit.",
	category: "baseline",
	sources: [
		{
			key: "default",
			label: "Contact schema",
			schema: {
				$schema: "https://json-schema.org/draft/2020-12/schema",
				type: "object",
				required: ["name", "email"],
				properties: {
					name: { type: "string", title: "Full Name", minLength: 1, description: "Your full legal name" },
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
