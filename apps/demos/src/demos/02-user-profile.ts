import type { FormDefinition, FormNode, ResponsiveSpan } from "@formbar/declarative";
import type { SchemaDemoFixture } from "./baseline-contracts";

function field(
	id: string,
	path: string,
	widget: string,
	label: string,
	span?: ResponsiveSpan,
	description?: string,
): FormNode {
	return {
		type: "field",
		id,
		binding: { namespace: "data", segments: [path] },
		widget,
		label,
		...(span ? { presentation: { span } } : {}),
		...(description ? { props: { description: { mode: "literal" as const, value: description } } } : {}),
	};
}

const half = { base: "full", md: 6 } as const;
const definition = {
	version: 1,
	id: "user-profile",
	root: {
		type: "group",
		id: "root",
		children: [
			{
				type: "section",
				id: "personal",
				title: "Personal Information",
				children: [
					field("f-firstName", "firstName", "text", "First Name", half),
					field("f-lastName", "lastName", "text", "Last Name", half),
					field("f-email", "email", "email", "Email", half),
					field("f-age", "age", "demo16.range", "Age", half),
				],
			},
			{
				type: "section",
				id: "work",
				title: "Work Details",
				children: [
					field("f-role", "role", "radio", "Role", half),
					field("f-department", "department", "select", "Department", half),
				],
			},
			{
				type: "section",
				id: "preferences",
				title: "Preferences",
				children: [
					field("f-bio", "bio", "textarea", "Bio", undefined, "Tell us about yourself"),
					field(
						"f-newsletter",
						"newsletter",
						"checkbox",
						"Subscribe to Newsletter",
						undefined,
						"Receive weekly updates",
					),
				],
			},
		],
	},
} satisfies FormDefinition;

export const userProfileDemo = {
	id: "user-profile",
	title: "2. User Profile",
	subtitle: "Sections, options, and numeric bounds",
	copy: "Multi-column profile layout with schema-backed options, a bounded age slider, biography, and newsletter preference.",
	category: "baseline",
	runtimeProfileIds: ["demo16.trusted-widgets.v1"],
	sources: [
		{
			key: "default",
			label: "Profile schema",
			schema: {
				type: "object",
				required: ["firstName", "lastName", "email", "role"],
				properties: {
					firstName: { type: "string", title: "First Name" },
					lastName: { type: "string", title: "Last Name" },
					email: { type: "string", title: "Email", format: "email" },
					age: { type: "integer", title: "Age", minimum: 18, maximum: 120 },
					role: {
						type: "string",
						title: "Role",
						enum: ["Developer", "Designer", "Manager", "QA", "DevOps"],
					},
					department: {
						type: "string",
						title: "Department",
						enum: ["Engineering", "Product", "Marketing", "Sales", "HR", "Finance", "Legal", "Operations"],
					},
					bio: { type: "string", title: "Bio", maxLength: 500, description: "Tell us about yourself" },
					newsletter: {
						type: "boolean",
						title: "Subscribe to Newsletter",
						description: "Receive weekly updates",
					},
				},
			},
			definition,
			initialData: {},
		},
	],
} as const satisfies SchemaDemoFixture;
