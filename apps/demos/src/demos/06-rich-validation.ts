import type { FormDefinition, FormNode } from "@formbar/declarative";
import { customWidgetProfile } from "../extensions/custom-widget-profile";
import type { SchemaDemoFixture } from "./baseline-contracts";

const binding = (path: string) => ({ namespace: "data" as const, segments: [path] });

function field(id: string, path: string, widget: string, label: string): FormNode {
	return { type: "field", id, binding: binding(path), widget, label };
}

function rangeField(id: string, path: string, label: string): FormNode {
	return {
		type: "field",
		id,
		binding: binding(path),
		widget: "demo16.range",
		label,
		props: { liveLabel: { mode: "literal", value: true } },
	};
}

export const richValidationSchema = {
	type: "object",
	required: ["username", "email", "password", "age", "website"],
	properties: {
		username: {
			type: "string",
			title: "Username",
			minLength: 3,
			maxLength: 20,
			pattern: "^[a-zA-Z0-9_]+$",
			description: "3-20 characters, letters, numbers, and underscores only",
		},
		email: {
			type: "string",
			title: "Email Address",
			format: "email",
			description: "Must be a valid email address",
		},
		password: { type: "string", title: "Password", minLength: 8, description: "Minimum 8 characters" },
		age: {
			type: "integer",
			title: "Age",
			minimum: 13,
			maximum: 150,
			multipleOf: 1,
			description: "Must be at least 13 years old",
		},
		website: { type: "string", title: "Website", format: "uri", description: "Your personal website URL" },
		score: {
			type: "number",
			title: "Satisfaction Score",
			minimum: 0,
			maximum: 10,
			multipleOf: 1,
			description: "Rate your experience from 0 to 10",
		},
	},
} as const;

export const richValidationDefinition = {
	version: 1,
	id: "rich-validation",
	root: {
		type: "group",
		id: "root",
		children: [
			field("f-username", "username", "text", "Username"),
			field("f-email", "email", "email", "Email Address"),
			field("f-password", "password", "password", "Password"),
			rangeField("f-age", "age", "Age"),
			field("f-website", "website", "url", "Website"),
			rangeField("f-score", "score", "Satisfaction Score"),
			{ type: "action", id: "validate", action: "validate", label: "Validate" },
			{ type: "action", id: "submit", action: "submit", label: "Submit" },
			{ type: "action", id: "reset", action: "reset", label: "Reset" },
		],
	},
} satisfies FormDefinition;

export const richValidationDemo = {
	id: "rich-validation",
	title: "6. Rich Validation",
	subtitle: "Pattern, format, range constraints",
	copy: "Demonstrates various JSON Schema validation constraints including min/max length, patterns, format validation, and number ranges.",
	category: "baseline",
	actionControls: "definition",
	runtimeProfile: customWidgetProfile,
	sources: [
		{
			key: "default",
			label: "Rich validation schema",
			schema: richValidationSchema,
			definition: richValidationDefinition,
			initialData: {},
		},
	],
} as const satisfies SchemaDemoFixture;
