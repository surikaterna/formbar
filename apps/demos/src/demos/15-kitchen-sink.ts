import type { FormDefinition, FormNode, ResponsiveSpan } from "@formbar/declarative";
import type { SchemaDemoFixture } from "./baseline-contracts";

function field(
	id: string,
	path: string,
	widget: string,
	label: string,
	description: string,
	span?: ResponsiveSpan,
): FormNode {
	return {
		type: "field",
		id,
		binding: { namespace: "data", segments: [path] },
		widget,
		label,
		props: { description: { mode: "literal", value: description } },
		...(span ? { presentation: { span } } : {}),
	};
}

const half = { base: "full", md: 6 } as const;
const definition = {
	version: 1,
	id: "kitchen-sink",
	root: {
		type: "group",
		id: "root",
		children: [
			{
				type: "section",
				id: "text-inputs",
				title: "Text Inputs",
				children: [
					field("f-text", "textField", "text", "Text Input", "Standard text field", half),
					field("f-email", "emailField", "email", "Email Input", "Email format validation", half),
					field("f-url", "urlField", "url", "URL Input", "URL format validation", half),
					field("f-required", "requiredField", "text", "Required Field", "Shows 'Required' badge", half),
				],
			},
			{
				type: "section",
				id: "textarea-inputs",
				title: "Textarea Variants",
				children: [
					field("f-textarea", "textareaField", "textarea", "Textarea", "Multi-line text via x-formbar widget hint"),
					field(
						"f-longtext",
						"longTextField",
						"textarea",
						"Auto Textarea",
						"Long text uses the supported textarea control",
					),
				],
			},
			{
				type: "section",
				id: "number-inputs",
				title: "Number Inputs",
				children: [
					field("f-number", "numberField", "number", "Number Input", "Free-form number", half),
					field("f-integer", "integerField", "number", "Integer Input", "Whole numbers only", half),
					field(
						"f-slider",
						"sliderField",
						"number",
						"Value from 0 to 100",
						"Constrained integer rendered as a native number",
						half,
					),
					field("f-with-default", "withDefault", "text", "With Default Value", "Pre-populated from initial data", half),
				],
			},
			{
				type: "section",
				id: "selection-inputs",
				title: "Selection Controls",
				children: [
					field(
						"f-radio",
						"selectSmall",
						"radio",
						"RadioGroup (≤5 options)",
						"Stored values use the original option order",
					),
					field("f-select", "selectLarge", "select", "Select (>5 options)", "Larger enums render as select dropdown"),
				],
			},
			{
				type: "section",
				id: "boolean-inputs",
				title: "Boolean Controls",
				children: [
					field("f-switch", "switchField", "checkbox", "Switch Toggle", "Boolean field uses a native checkbox"),
				],
			},
		],
	},
} satisfies FormDefinition;

export const kitchenSinkDemo = {
	id: "kitchen-sink",
	title: "15. Kitchen Sink",
	subtitle: "Released native widget matrix",
	copy: "The original kitchen-sink fields use the released native controls; unsupported option cosmetics and slider presentation are intentionally omitted.",
	category: "sources",
	sources: [
		{
			key: "default",
			label: "Kitchen sink schema",
			schema: {
				type: "object",
				required: ["textField", "emailField", "selectSmall", "selectLarge", "requiredField"],
				properties: {
					textField: { type: "string", title: "Text Input", description: "Standard text field" },
					emailField: { type: "string", title: "Email Input", format: "email", description: "Email format validation" },
					urlField: { type: "string", title: "URL Input", format: "uri", description: "URL format validation" },
					textareaField: {
						type: "string",
						title: "Textarea",
						"x-formbar": { widget: "textarea" },
						description: "Multi-line text via x-formbar widget hint",
					},
					longTextField: {
						type: "string",
						title: "Auto Textarea",
						maxLength: 500,
						description: "Becomes textarea when maxLength > 200",
					},
					numberField: { type: "number", title: "Number Input", description: "Free-form number" },
					integerField: { type: "integer", title: "Integer Input", description: "Whole numbers only" },
					sliderField: {
						type: "integer",
						title: "Value from 0 to 100",
						minimum: 0,
						maximum: 100,
						description: "Constrained integer rendered as a native number",
					},
					switchField: {
						type: "boolean",
						title: "Switch Toggle",
						description: "Boolean field historically rendered as switch",
					},
					selectSmall: {
						type: "string",
						title: "RadioGroup (≤5 options)",
						enum: ["standard", "legacy", "custom"],
						description: "Stored values retain their canonical option order",
					},
					selectLarge: {
						type: "string",
						title: "Select (>5 options)",
						enum: ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel"],
						description: "Larger enums render as select dropdown",
					},
					requiredField: { type: "string", title: "Required Field", description: "Shows 'Required' badge" },
					withDefault: { type: "string", title: "With Default Value", description: "Pre-populated from initial data" },
				},
			},
			definition,
			initialData: { selectSmall: "legacy", withDefault: "Hello, ARB!" },
		},
	],
} as const satisfies SchemaDemoFixture;
