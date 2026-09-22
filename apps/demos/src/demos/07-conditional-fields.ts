import type { Expression, FormDefinition, FormNode } from "@formbar/declarative";
import type { SchemaDemoFixture } from "./baseline-contracts";

const ref = (path: string): Expression => ({ kind: "ref", ref: { namespace: "data", segments: [path] } });
const literal = (value: string): Expression => ({ kind: "literal", value });
const equals = (path: string, value: string): Expression => ({
	kind: "op",
	op: "eq",
	args: [ref(path), literal(value)],
});
const binding = (path: string) => ({ namespace: "data" as const, segments: [path] });

function field(id: string, path: string, widget: string, label: string, description?: string): FormNode {
	return {
		type: "field",
		id,
		binding: binding(path),
		widget,
		label,
		...(description ? { props: { description: { mode: "literal" as const, value: description } } } : {}),
	};
}

function branch(id: string, status: string, section: FormNode, otherwise: readonly FormNode[] = []): FormNode {
	return {
		type: "conditional",
		id,
		condition: equals("employmentStatus", status),
		// biome-ignore lint/suspicious/noThenProperty: This is serialized FormDefinition branch data.
		then: [section],
		else: otherwise,
	};
}

const insurance = (branchId: string) =>
	field(
		`f-health-insurance-${branchId}`,
		"hasHealthInsurance",
		"checkbox",
		"Health Insurance",
		"Do you have health insurance?",
	);
const income = (branchId: string) => field(`f-annual-income-${branchId}`, "annualIncome", "number", "Annual Income");

const unemployed = branch("when-unemployed", "Unemployed", {
	type: "section",
	id: "unemployed-details",
	title: "Details",
	children: [insurance("unemployed")],
});
const retired = branch(
	"when-retired",
	"Retired",
	{
		type: "section",
		id: "retired-details",
		title: "Details",
		children: [income("retired"), insurance("retired")],
	},
	[unemployed],
);
const student = branch(
	"when-student",
	"Student",
	{
		type: "section",
		id: "education-details",
		title: "Education Details",
		children: [
			field("f-school-name", "schoolName", "text", "School / University"),
			field("f-field-of-study", "fieldOfStudy", "text", "Field of Study"),
			insurance("student"),
		],
	},
	[retired],
);
const selfEmployed = branch(
	"when-self-employed",
	"Self-Employed",
	{
		type: "section",
		id: "business-details",
		title: "Business Details",
		children: [
			field("f-business-name", "businessName", "text", "Business Name"),
			field("f-business-type", "businessType", "select", "Business Type"),
			income("self-employed"),
			insurance("self-employed"),
		],
	},
	[student],
);

export const conditionalFieldsDefinition = {
	version: 1,
	id: "conditional-fields",
	root: {
		type: "group",
		id: "root",
		children: [
			field("f-employment-status", "employmentStatus", "radio", "Employment Status"),
			{
				type: "conditional",
				id: "when-status-selected",
				condition: { kind: "op", op: "exists", args: [ref("employmentStatus")] },
				// biome-ignore lint/suspicious/noThenProperty: This is serialized FormDefinition branch data.
				then: [
					branch(
						"when-employed",
						"Employed",
						{
							type: "section",
							id: "employment-details",
							title: "Employment Details",
							children: [
								field("f-company-name", "companyName", "text", "Company Name", "Your employer"),
								field("f-job-title", "jobTitle", "text", "Job Title"),
								income("employed"),
								insurance("employed"),
							],
						},
						[selfEmployed],
					),
				],
			},
		],
	},
} satisfies FormDefinition;

export const conditionalFieldsSchema = {
	type: "object",
	required: ["employmentStatus"],
	properties: {
		employmentStatus: {
			type: "string",
			title: "Employment Status",
			enum: ["Employed", "Self-Employed", "Student", "Retired", "Unemployed"],
		},
		companyName: { type: "string", title: "Company Name", description: "Your employer" },
		jobTitle: { type: "string", title: "Job Title" },
		businessName: { type: "string", title: "Business Name" },
		businessType: {
			type: "string",
			title: "Business Type",
			enum: ["Sole Proprietorship", "LLC", "Corporation", "Partnership"],
		},
		schoolName: { type: "string", title: "School / University" },
		fieldOfStudy: { type: "string", title: "Field of Study" },
		annualIncome: { type: "number", title: "Annual Income", minimum: 0 },
		hasHealthInsurance: {
			type: "boolean",
			title: "Health Insurance",
			description: "Do you have health insurance?",
		},
	},
} as const;

export const conditionalFieldsDemo = {
	id: "conditional-fields",
	title: "7. Conditional Fields",
	subtitle: "Employment-specific native branches",
	copy: "Employment details mount from native serializable conditions. Switching branches retains values already entered in hidden fields.",
	category: "conditional",
	sources: [
		{
			key: "default",
			label: "Conditional employment schema",
			schema: conditionalFieldsSchema,
			definition: conditionalFieldsDefinition,
			initialData: {},
		},
	],
} as const satisfies SchemaDemoFixture;
