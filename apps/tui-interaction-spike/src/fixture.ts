import { type FormApi, createForm } from "@formbar/core";
import type { FormbarOption, SchemaFormResult } from "@formbar/from-schema";

export interface FixtureData extends Record<string, unknown> {
	name: string;
	age: number;
	enabled: boolean;
	color: string;
}

const colors: readonly FormbarOption[] = [
	"Red",
	"Orange",
	"Yellow",
	"Green",
	"Blue",
	"Indigo",
	"Violet",
	"Black",
	"White",
	"Gray",
	"Cyan",
].map((title, index) => ({ value: title.toLocaleLowerCase(), title, ...(index === 7 ? { disabled: true } : {}) }));

export const fixtureSchema: SchemaFormResult = {
	fields: [
		{
			path: "name",
			type: "string",
			required: true,
			metadata: { title: "Name", description: "Display name" },
		},
		{
			path: "age",
			type: "integer",
			required: true,
			metadata: { title: "Age", description: "Whole number from 0 to 130", minimum: 0, maximum: 130 },
		},
		{ path: "enabled", type: "boolean", required: false, metadata: { title: "Enabled" } },
		{ path: "color", type: "string", required: true, metadata: { title: "Color" } },
	],
	layout: {
		type: "section",
		id: "root",
		children: [
			{
				type: "group",
				id: "identity",
				props: { columns: 2 },
				children: [
					{ type: "field", id: "name-field", path: "name" },
					{ type: "field", id: "age-field", path: "age" },
				],
			},
			{
				type: "group",
				id: "preferences",
				children: [
					{ type: "field", id: "enabled-field", path: "enabled" },
					{ type: "field", id: "color-field", path: "color" },
				],
			},
		],
	},
	metadata: { title: "Standalone profile" },
	validators: [],
	defaults: { name: "Ada", age: 37, enabled: true, color: "blue" },
	optionsByPath: new Map([["color", colors]]),
	warnings: [],
};

export function createFixtureForm(onSubmit?: () => void): FormApi<Record<string, unknown>, unknown> {
	return createForm<Record<string, unknown>, unknown>({
		initialData: { name: "Ada", age: 37, enabled: true, color: "blue" },
		idGenerator: () => "fixture-submit",
		onSubmit: async () => {
			onSubmit?.();
			return { ok: true, submitId: "fixture-submit" };
		},
		validators: [
			({ data }) =>
				typeof data.age === "number" && data.age > 130
					? [
							{
								code: "age-maximum",
								message: "Age exceeds maximum",
								severity: "error" as const,
								path: { namespace: "data" as const, segments: ["age"] },
								source: { origin: "function-validator" as const, validatorId: "fixture-age-maximum" },
							},
						]
					: [],
		],
	});
}
