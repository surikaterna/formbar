import type { ArbiterPluginOptions } from "@formbar/arbiter";
import type { Expression, FormDefinition, FormNode } from "@formbar/declarative";
import type { SchemaDemoFixture } from "./baseline-contracts";

function field(id: string, path: string, widget: string, label: string): FormNode {
	return { type: "field", id, binding: { namespace: "data", segments: [path] }, widget, label };
}

const canSubmit: Expression = { kind: "ref", ref: { namespace: "ui", segments: ["canSubmit"] } };

export const arbiterValidationRules = [
	{
		name: "canSubmit",
		when: { agreeToTerms: true },
		// biome-ignore lint/suspicious/noThenProperty: This is serialized Arbitre rule data.
		then: [{ $set: { "$ui.canSubmit": true } }],
	},
	{
		name: "cannotSubmit",
		when: { agreeToTerms: { $ne: true } },
		// biome-ignore lint/suspicious/noThenProperty: This is serialized Arbitre rule data.
		then: [{ $set: { "$ui.canSubmit": false } }],
	},
] satisfies NonNullable<ArbiterPluginOptions["rules"]>;

export const arbiterValidationSchema = {
	type: "object",
	required: ["name", "email", "age", "agreeToTerms"],
	properties: {
		name: { type: "string", title: "Full Name", minLength: 1 },
		email: { type: "string", title: "Email", format: "email" },
		age: { type: "number", title: "Age", minimum: 18 },
		agreeToTerms: { type: "boolean", title: "I agree to the Terms of Service", const: true },
	},
} as const;

export const arbiterValidationData = { name: "", email: "", age: 0, agreeToTerms: false } as const;
export const arbiterValidationUiState = { canSubmit: false } as const;

export const arbiterValidationDefinition = {
	version: 1,
	id: "arbiter-validation-gating",
	root: {
		type: "section",
		id: "signup-form",
		title: "Signup Form",
		children: [
			field("f-name", "name", "text", "Full Name"),
			field("f-email", "email", "email", "Email"),
			field("f-age", "age", "number", "Age"),
			field("f-terms", "agreeToTerms", "checkbox", "I agree to the Terms of Service"),
			{
				type: "action",
				id: "submit",
				action: "submit",
				label: "Submit",
				disabled: { kind: "op", op: "not", args: [canSubmit] },
			},
			{ type: "action", id: "reset", action: "reset", label: "Reset" },
		],
	},
} satisfies FormDefinition;

export const arbiterValidationDemo = {
	id: "arbiter-validation-gating",
	title: "20. Arbiter: Validation Gating",
	subtitle: "Presentation gating plus schema validation",
	copy: "Arbiter controls the terms presentation gate while Draft 2020-12 and core validate every field.",
	category: "conditional",
	actionControls: "definition",
	sources: [
		{
			key: "default",
			label: "Validation gating schema",
			schema: arbiterValidationSchema,
			definition: arbiterValidationDefinition,
			initialData: arbiterValidationData,
			initialUiState: arbiterValidationUiState,
			arbiterRules: arbiterValidationRules,
		},
	],
} as const satisfies SchemaDemoFixture;
