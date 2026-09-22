import type { Expression, FieldNode, FormDefinition, FormNode, ResponsiveSpan } from "@formbar/declarative";
import type { SchemaDemoFixture } from "./baseline-contracts";

const contactRef: Expression = { kind: "ref", ref: { namespace: "data", segments: ["contactForFollowUp"] } };
export const followUpCondition: Expression = {
	kind: "op",
	op: "eq",
	args: [contactRef, { kind: "literal", value: true }],
};
const half = { base: "full", md: 6 } satisfies ResponsiveSpan;

function field(
	id: string,
	path: string,
	widget: string,
	label: string,
	description?: string,
	span?: ResponsiveSpan,
): FieldNode {
	return {
		type: "field",
		id,
		binding: { namespace: "data", segments: [path] },
		widget,
		label,
		...(description ? { props: { description: { mode: "literal" as const, value: description } } } : {}),
		...(span ? { presentation: { span } } : {}),
	};
}

const definition = {
	version: 1,
	id: "survey",
	root: {
		type: "group",
		id: "root",
		children: [
			{
				type: "section",
				id: "ratings",
				title: "Ratings",
				children: [
					field(
						"f-satisfaction",
						"satisfaction",
						"radio",
						"Overall Satisfaction",
						"How satisfied are you with our service?",
					),
					field("f-recommend", "recommend", "radio", "Would You Recommend Us?"),
					field(
						"f-nps",
						"npsScore",
						"number",
						"Net Promoter Score",
						"How likely are you to recommend us? (0 = Not at all, 10 = Extremely likely)",
					),
				],
			},
			{
				type: "section",
				id: "features",
				title: "Product Feedback",
				children: [
					field("f-best", "bestFeature", "radio", "Best Feature", "What do you value most?", half),
					field("f-improve", "improvementArea", "select", "Area for Improvement", "Where should we focus?", half),
					field("f-usage", "usageFrequency", "radio", "How Often Do You Use Our Product?", undefined, half),
				],
			},
			{
				type: "section",
				id: "comments",
				title: "Comments",
				children: [
					field(
						"f-feedback",
						"feedback",
						"textarea",
						"Additional Feedback",
						"Share any additional thoughts or suggestions",
					),
				],
			},
			{
				type: "section",
				id: "contact",
				title: "Follow-Up",
				children: [
					field(
						"f-contact-ok",
						"contactForFollowUp",
						"checkbox",
						"May We Contact You?",
						"We may reach out to discuss your feedback",
						half,
					),
					{
						type: "conditional",
						id: "when-follow-up",
						condition: followUpCondition,
						// biome-ignore lint/suspicious/noThenProperty: This is serialized FormDefinition branch data.
						then: [
							{
								...field("f-email", "email", "email", "Email", undefined, half),
								required: followUpCondition,
							},
						],
					},
				],
			},
		],
	},
} satisfies FormDefinition;

export const surveySchema = {
	type: "object",
	required: ["satisfaction", "recommend"],
	properties: {
		satisfaction: {
			type: "string",
			title: "Overall Satisfaction",
			enum: ["Very Satisfied", "Satisfied", "Neutral", "Dissatisfied", "Very Dissatisfied"],
			description: "How satisfied are you with our service?",
		},
		recommend: {
			type: "string",
			title: "Would You Recommend Us?",
			enum: ["Definitely", "Probably", "Not Sure", "Probably Not", "Definitely Not"],
		},
		npsScore: {
			type: "integer",
			title: "Net Promoter Score",
			minimum: 0,
			maximum: 10,
			description: "How likely are you to recommend us? (0 = Not at all, 10 = Extremely likely)",
		},
		bestFeature: {
			type: "string",
			title: "Best Feature",
			enum: ["Performance", "Ease of Use", "Design", "Reliability", "Support"],
			description: "What do you value most?",
		},
		improvementArea: {
			type: "string",
			title: "Area for Improvement",
			enum: ["Performance", "Documentation", "Onboarding", "Pricing", "Mobile Experience"],
			description: "Where should we focus?",
		},
		usageFrequency: {
			type: "string",
			title: "How Often Do You Use Our Product?",
			enum: ["Daily", "Weekly", "Monthly", "Rarely"],
		},
		feedback: {
			type: "string",
			title: "Additional Feedback",
			maxLength: 2000,
			description: "Share any additional thoughts or suggestions",
		},
		contactForFollowUp: {
			type: "boolean",
			title: "May We Contact You?",
			description: "We may reach out to discuss your feedback",
		},
		email: { type: "string", title: "Email", format: "email" },
	},
} as const;

export const surveyDemo = {
	id: "survey",
	title: "12. Survey / Questionnaire",
	subtitle: "Native conditional follow-up",
	copy: "The follow-up email is conditionally mounted and marked required as a presentation cue. JSON Schema and explicit validators—not that cue—remain validation authority.",
	category: "conditional",
	sources: [
		{
			key: "default",
			label: "Customer satisfaction survey schema",
			schema: surveySchema,
			definition,
			initialData: { contactForFollowUp: false },
		},
	],
} as const satisfies SchemaDemoFixture;
