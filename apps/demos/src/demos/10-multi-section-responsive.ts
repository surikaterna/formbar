import type { FormDefinition, FormNode, ResponsiveSpan } from "@formbar/declarative";
import type { SchemaDemoFixture } from "./baseline-contracts";

function field(id: string, name: string, widget: string, label: string, span: ResponsiveSpan): FormNode {
	return {
		type: "field",
		id,
		binding: { namespace: "data", segments: [name] },
		widget,
		label,
		presentation: { span },
	};
}

const half = { base: "full", md: 6 } as const;
const definition = {
	version: 1,
	id: "responsive-registration",
	root: {
		type: "group",
		id: "responsive-root",
		children: [
			{
				type: "section",
				id: "responsive-personal",
				title: "Personal details",
				description: "These fields become two columns at the md breakpoint.",
				children: [
					field("responsive-first-name", "firstName", "text", "First name", half),
					field("responsive-last-name", "lastName", "text", "Last name", half),
					field("responsive-birth-date", "birthDate", "date", "Birth date", half),
					field("responsive-phone", "phone", "tel", "Phone", half),
				],
			},
			{
				type: "section",
				id: "responsive-contact",
				title: "Account",
				children: [
					field("responsive-email", "email", "email", "Email", half),
					field("responsive-user-name", "userName", "text", "User name", half),
					field("responsive-notes", "notes", "textarea", "Notes", { base: "full", md: "full" }),
				],
			},
		],
	},
} satisfies FormDefinition;

export const responsiveSectionsDemo = {
	id: "multi-section-responsive",
	title: "10. Multi-section responsive",
	subtitle: "Typed spans with visible CSS",
	copy: "Typed span output is one column when narrow and two columns from the md breakpoint.",
	category: "layout",
	sources: [
		{
			key: "default",
			label: "Registration schema",
			schema: {
				type: "object",
				properties: {
					firstName: { type: "string", title: "First name" },
					lastName: { type: "string", title: "Last name" },
					birthDate: { type: "string", title: "Birth date", format: "date" },
					phone: { type: "string", title: "Phone", format: "tel" },
					email: { type: "string", title: "Email", format: "email" },
					userName: { type: "string", title: "User name", minLength: 3 },
					notes: { type: "string", title: "Notes", "x-formbar": { widget: "textarea" } },
				},
				required: ["firstName", "lastName", "email", "userName"],
			},
			definition,
			initialData: {
				firstName: "Grace",
				lastName: "Hopper",
				birthDate: "1906-12-09",
				phone: "+1 555 0100",
				email: "grace@example.com",
				userName: "grace",
				notes: "Responsive layout evidence.",
			},
		},
	],
} as const satisfies SchemaDemoFixture;
