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
	id: "multi-section-responsive",
	root: {
		type: "group",
		id: "root",
		children: [
			{
				type: "section",
				id: "personal",
				title: "Personal Details",
				children: [
					field("f-first", "firstName", "text", "First Name", half),
					field("f-last", "lastName", "text", "Last Name", half),
					field("f-dob", "dateOfBirth", "date", "Date of Birth", half, "YYYY-MM-DD format"),
					field("f-gender", "gender", "radio", "Gender", half),
					field("f-nationality", "nationality", "text", "Nationality", half),
					field("f-passport", "passportNumber", "text", "Passport Number", half),
				],
			},
			{
				type: "section",
				id: "emergency",
				title: "Emergency Contact",
				children: [
					field("f-ecName", "emergencyContactName", "text", "Emergency Contact Name", half),
					field("f-ecPhone", "emergencyContactPhone", "tel", "Emergency Contact Phone", half),
					field("f-ecRel", "emergencyRelationship", "radio", "Relationship", half),
				],
			},
			{
				type: "section",
				id: "health",
				title: "Health & Preferences",
				children: [
					field(
						"f-medical",
						"medicalConditions",
						"textarea",
						"Medical Conditions",
						undefined,
						"List any relevant medical conditions",
					),
					field("f-dietary", "dietaryRequirements", "select", "Dietary Requirements"),
				],
			},
			{
				type: "section",
				id: "agreement",
				title: "Agreement",
				children: [field("f-terms", "agreesToTerms", "checkbox", "I agree to the terms and conditions")],
			},
		],
	},
} satisfies FormDefinition;

export const responsiveSectionsDemo = {
	id: "multi-section-responsive",
	title: "10. Multi-Section Responsive Form",
	subtitle: "Passenger registration with typed spans",
	copy: "The original passenger registration domain uses typed spans that collapse its two-column sections on narrow viewports.",
	category: "layout",
	sources: [
		{
			key: "default",
			label: "Passenger registration schema",
			schema: {
				type: "object",
				required: ["firstName", "lastName"],
				properties: {
					firstName: { type: "string", title: "First Name" },
					lastName: { type: "string", title: "Last Name" },
					dateOfBirth: { type: "string", title: "Date of Birth", format: "date", description: "YYYY-MM-DD format" },
					gender: { type: "string", title: "Gender", enum: ["Male", "Female", "Non-Binary", "Prefer not to say"] },
					nationality: { type: "string", title: "Nationality" },
					passportNumber: { type: "string", title: "Passport Number" },
					emergencyContactName: { type: "string", title: "Emergency Contact Name" },
					emergencyContactPhone: { type: "string", title: "Emergency Contact Phone", format: "tel" },
					emergencyRelationship: {
						type: "string",
						title: "Relationship",
						enum: ["Spouse", "Parent", "Sibling", "Friend", "Other"],
					},
					medicalConditions: {
						type: "string",
						title: "Medical Conditions",
						"x-formbar": { widget: "textarea" },
						description: "List any relevant medical conditions",
					},
					dietaryRequirements: {
						type: "string",
						title: "Dietary Requirements",
						enum: ["None", "Vegetarian", "Vegan", "Halal", "Kosher", "Gluten-Free"],
					},
					agreesToTerms: { type: "boolean", title: "I agree to the terms and conditions" },
				},
			},
			definition,
			initialData: {},
		},
	],
} as const satisfies SchemaDemoFixture;
