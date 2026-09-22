import type { FormDefinition } from "@formbar/declarative";
import type { SchemaDemoFixture } from "./baseline-contracts";

const definition = {
	version: 1,
	id: "user-profile",
	root: {
		type: "group",
		id: "profile-root",
		children: [
			{
				type: "section",
				id: "profile-identity",
				title: "Identity",
				children: [
					field("profile-first-name", "firstName", "text", "First name"),
					field("profile-last-name", "lastName", "text", "Last name"),
					field("profile-email", "email", "email", "Email"),
					field("profile-age", "age", "number", "Age"),
				],
			},
			{
				type: "section",
				id: "profile-work",
				title: "Work",
				children: [
					field("profile-role", "role", "select", "Role"),
					field("profile-department", "department", "select", "Department"),
				],
			},
			{
				type: "section",
				id: "profile-about",
				title: "About you",
				children: [
					{ ...field("profile-bio", "bio", "textarea", "Biography"), presentation: { span: "full" } },
					{
						...field("profile-newsletter", "newsletter", "checkbox", "Email newsletter"),
						presentation: { span: "full" },
					},
				],
			},
		],
	},
} satisfies FormDefinition;

function field(id: string, name: string, widget: string, label: string) {
	return {
		type: "field" as const,
		id,
		binding: { namespace: "data" as const, segments: [name] },
		widget,
		label,
		presentation: { span: { base: "full" as const, md: 6 as const } },
	};
}

export const userProfileDemo = {
	id: "user-profile",
	title: "2. User profile",
	subtitle: "Sections, selects, and numeric bounds",
	copy: "An explicit definition arranges schema-backed fields without replacing production rendering.",
	category: "baseline",
	sources: [
		{
			key: "default",
			label: "Profile schema",
			schema: {
				type: "object",
				properties: {
					firstName: { type: "string", title: "First name" },
					lastName: { type: "string", title: "Last name" },
					email: { type: "string", title: "Email", format: "email" },
					age: { type: "integer", title: "Age", minimum: 18, maximum: 120 },
					role: { title: "Role", enum: ["Developer", "Designer", "Manager"] },
					department: { title: "Department", enum: ["Engineering", "Design", "Operations"] },
					bio: { type: "string", title: "Biography", maxLength: 500 },
					newsletter: { type: "boolean", title: "Email newsletter", default: true },
				},
				required: ["firstName", "lastName", "email", "age"],
			},
			definition,
			initialData: {
				firstName: "Ada",
				lastName: "Lovelace",
				email: "ada@example.com",
				age: 36,
				role: "Developer",
				department: "Engineering",
				bio: "Computing pioneer",
				newsletter: true,
			},
		},
	],
} as const satisfies SchemaDemoFixture;
