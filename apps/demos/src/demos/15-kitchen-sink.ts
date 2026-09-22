import type { FormDefinition, FormNode } from "@formbar/declarative";
import type { SchemaDemoFixture } from "./baseline-contracts";

function field(id: string, name: string, widget: string, label: string, description?: string): FormNode {
	return {
		type: "field",
		id,
		binding: { namespace: "data", segments: [name] },
		widget,
		label,
		presentation: { span: { base: "full", md: 6 } },
		...(description ? { props: { description: { mode: "literal" as const, value: description } } } : {}),
	};
}

const definition = {
	version: 1,
	id: "kitchen-sink",
	root: {
		type: "group",
		id: "kitchen-root",
		children: [
			{
				type: "section",
				id: "kitchen-text",
				title: "Text controls",
				children: [
					field("kitchen-required", "requiredField", "text", "Required field", "This field is required by the schema."),
					field("kitchen-textarea", "longText", "textarea", "Long text"),
					field("kitchen-password", "password", "password", "Password"),
					field("kitchen-search", "search", "search", "Search"),
				],
			},
			{
				type: "section",
				id: "kitchen-scalars",
				title: "Scalar controls",
				children: [
					field("kitchen-number", "numberValue", "number", "Decimal number"),
					field("kitchen-integer", "integerValue", "number", "Integer"),
					field("kitchen-percent", "percent", "number", "Value from 0 to 100"),
					field("kitchen-checkbox", "enabled", "checkbox", "Enabled"),
					field("kitchen-select", "selectValue", "select", "Select option"),
					field("kitchen-radio", "radioValue", "radio", "Radio option"),
				],
			},
			{
				type: "section",
				id: "kitchen-formats",
				title: "String formats",
				children: [
					field("kitchen-email", "email", "email", "Email"),
					field("kitchen-url", "url", "url", "URL"),
					field("kitchen-tel", "telephone", "tel", "Telephone"),
					field("kitchen-date", "date", "date", "Date"),
					field("kitchen-time", "time", "time", "Time"),
				],
			},
		],
	},
} satisfies FormDefinition;

export const kitchenSinkDemo = {
	id: "kitchen-sink",
	title: "15. Kitchen sink",
	subtitle: "Released native widget matrix",
	copy: "Production defaults render the released native widget matrix; richer custom widgets remain outside this demo.",
	category: "sources",
	sources: [
		{
			key: "default",
			label: "Kitchen sink schema",
			schema: {
				type: "object",
				properties: {
					requiredField: { type: "string", title: "Required field", minLength: 1 },
					longText: { type: "string", title: "Long text", maxLength: 500 },
					password: { type: "string", title: "Password" },
					search: { type: "string", title: "Search" },
					numberValue: { type: "number", title: "Decimal number", minimum: -10, maximum: 10 },
					integerValue: { type: "integer", title: "Integer", minimum: 0, maximum: 10 },
					percent: { type: "integer", title: "Value from 0 to 100", minimum: 0, maximum: 100 },
					enabled: { type: "boolean", title: "Enabled" },
					selectValue: { title: "Select option", enum: ["Alpha", "Beta", "Gamma"] },
					radioValue: { title: "Radio option", enum: ["One", "Two", "Three"] },
					email: { type: "string", title: "Email", format: "email" },
					url: { type: "string", title: "URL", format: "uri" },
					telephone: { type: "string", title: "Telephone", format: "tel" },
					date: { type: "string", title: "Date", format: "date" },
					time: { type: "string", title: "Time", format: "time" },
				},
				required: ["requiredField", "selectValue"],
			},
			definition,
			initialData: {
				requiredField: "Initial value",
				longText: "A longer initial value.",
				password: "secret",
				search: "forms",
				numberValue: 2.5,
				integerValue: 4,
				percent: 75,
				enabled: true,
				selectValue: "Beta",
				radioValue: "Two",
				email: "hello@example.com",
				url: "https://example.com",
				telephone: "+1 555 0123",
				date: "2026-09-22",
				time: "14:30",
			},
		},
	],
} as const satisfies SchemaDemoFixture;
