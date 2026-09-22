import { createArbiterPlugin } from "@formbar/arbiter";
import { createForm } from "@formbar/core";
import type { FormApi } from "@formbar/core";
import type { FieldNode, FormNode } from "@formbar/declarative";
import { createSchemaForm, jsonSchemaProvider } from "@formbar/from-schema";
import { describe, expect, it } from "vitest";
import {
	conditionalFieldsDefinition,
	conditionalFieldsDemo,
	conditionalFieldsSchema,
} from "../demos/07-conditional-fields";
import { followUpCondition, surveyDemo, surveySchema } from "../demos/12-survey-questionnaire";
import {
	arbiterVisibilityData,
	arbiterVisibilityDemo,
	arbiterVisibilityRules,
	arbiterVisibilitySchema,
} from "../demos/18-arbiter-visibility";
import {
	arbiterDynamicSectionsDemo,
	arbiterSectionsData,
	arbiterSectionsRules,
	arbiterSectionsSchema,
} from "../demos/21-arbiter-dynamic-sections";

const provider = jsonSchemaProvider({ dialect: "draft-2020-12" });
const fixtures = [conditionalFieldsDemo, surveyDemo, arbiterVisibilityDemo, arbiterDynamicSectionsDemo];

function nodes(node: FormNode): readonly FormNode[] {
	if (node.type === "conditional") return [node, ...node.then.flatMap(nodes), ...(node.else ?? []).flatMap(nodes)];
	if (node.type === "group" || node.type === "section" || node.type === "repeater") {
		return [node, ...node.children.flatMap(nodes)];
	}
	return [node];
}

function fields(definition: (typeof fixtures)[number]["sources"][number]["definition"]) {
	if (!definition) throw new Error("Expected authored definition");
	return nodes(definition.root)
		.filter((node): node is FieldNode => node.type === "field")
		.map((node) => [node.binding.segments.join("."), node.widget, node.label]);
}

function schemaProperties(schema: { readonly properties: Readonly<Record<string, unknown>> }) {
	return Object.keys(schema.properties);
}

function policy<TData, TUi>(form: FormApi<TData, TUi>) {
	return Object.fromEntries(
		form
			.getState()
			.fieldPolicy.map((entry) => [
				`/${entry.path.segments.join("/")}`,
				entry.visible === undefined ? entry.required : entry.visible,
			]),
	);
}

describe("conditional fixture fidelity", () => {
	it("compiles every serializable schema and authored definition without definition errors", () => {
		for (const fixture of fixtures) {
			const source = fixture.sources[0];
			expect(() => JSON.stringify(fixture), fixture.id).not.toThrow();
			const compiled = createSchemaForm(source.schema, {
				provider,
				side: "input",
				definition: source.definition,
			});
			expect(compiled.diagnostics.definition, fixture.id).toEqual([]);
		}
	});

	it("retains demo 7's exact historical fields, choices, bounds, and branch ownership", () => {
		expect(schemaProperties(conditionalFieldsSchema)).toEqual([
			"employmentStatus",
			"companyName",
			"jobTitle",
			"businessName",
			"businessType",
			"schoolName",
			"fieldOfStudy",
			"annualIncome",
			"hasHealthInsurance",
		]);
		expect(conditionalFieldsSchema.required).toEqual(["employmentStatus"]);
		expect(conditionalFieldsSchema.properties.employmentStatus.enum).toEqual([
			"Employed",
			"Self-Employed",
			"Student",
			"Retired",
			"Unemployed",
		]);
		expect(conditionalFieldsSchema.properties.businessType.enum).toEqual([
			"Sole Proprietorship",
			"LLC",
			"Corporation",
			"Partnership",
		]);
		expect(conditionalFieldsSchema.properties.annualIncome.minimum).toBe(0);
		expect(conditionalFieldsDemo.sources[0].initialData).toEqual({});
		expect(fields(conditionalFieldsDefinition)).toEqual([
			["employmentStatus", "radio", "Employment Status"],
			["companyName", "text", "Company Name"],
			["jobTitle", "text", "Job Title"],
			["annualIncome", "number", "Annual Income"],
			["hasHealthInsurance", "checkbox", "Health Insurance"],
			["businessName", "text", "Business Name"],
			["businessType", "select", "Business Type"],
			["annualIncome", "number", "Annual Income"],
			["hasHealthInsurance", "checkbox", "Health Insurance"],
			["schoolName", "text", "School / University"],
			["fieldOfStudy", "text", "Field of Study"],
			["hasHealthInsurance", "checkbox", "Health Insurance"],
			["annualIncome", "number", "Annual Income"],
			["hasHealthInsurance", "checkbox", "Health Insurance"],
			["hasHealthInsurance", "checkbox", "Health Insurance"],
		]);
		expect(
			nodes(conditionalFieldsDefinition.root)
				.filter((node) => node.type === "section")
				.map((node) => node.title),
		).toEqual(["Employment Details", "Business Details", "Education Details", "Details", "Details"]);
	});

	it("retains demo 12's nine-field survey schema and truthful conditional cue", () => {
		expect(schemaProperties(surveySchema)).toEqual([
			"satisfaction",
			"recommend",
			"npsScore",
			"bestFeature",
			"improvementArea",
			"usageFrequency",
			"feedback",
			"contactForFollowUp",
			"email",
		]);
		expect(surveySchema.required).toEqual(["satisfaction", "recommend"]);
		expect(surveySchema.properties.npsScore).toMatchObject({ type: "integer", minimum: 0, maximum: 10 });
		expect(surveySchema.properties.feedback.maxLength).toBe(2000);
		expect(surveySchema.properties.email).toEqual({ type: "string", title: "Email", format: "email" });
		expect([
			surveySchema.properties.satisfaction.enum,
			surveySchema.properties.recommend.enum,
			surveySchema.properties.bestFeature.enum,
			surveySchema.properties.improvementArea.enum,
			surveySchema.properties.usageFrequency.enum,
		]).toEqual([
			["Very Satisfied", "Satisfied", "Neutral", "Dissatisfied", "Very Dissatisfied"],
			["Definitely", "Probably", "Not Sure", "Probably Not", "Definitely Not"],
			["Performance", "Ease of Use", "Design", "Reliability", "Support"],
			["Performance", "Documentation", "Onboarding", "Pricing", "Mobile Experience"],
			["Daily", "Weekly", "Monthly", "Rarely"],
		]);
		expect(surveyDemo.sources[0].initialData).toEqual({});
		const authored = fields(surveyDemo.sources[0].definition);
		expect(authored.map(([path]) => path)).toEqual(schemaProperties(surveySchema));
		expect(authored.map(([, widget]) => widget)).toEqual([
			"radio",
			"radio",
			"number",
			"radio",
			"select",
			"radio",
			"textarea",
			"checkbox",
			"email",
		]);
		const email = nodes(surveyDemo.sources[0].definition.root).find((node) => node.id === "f-email");
		expect(email?.type === "field" ? email.required : undefined).toEqual(followUpCondition);
		expect(surveyDemo.copy).toContain("presentation cue");
	});

	it("retains demo 18's full typed regional schema and complete policy records", () => {
		expect(schemaProperties(arbiterVisibilitySchema)).toEqual(["country", "state", "province", "region"]);
		expect(arbiterVisibilitySchema.properties.country.enum).toEqual(["US", "CA", "UK", "DE"]);
		expect(arbiterVisibilitySchema.properties.state.enum).toEqual(["California", "New York", "Texas", "Florida"]);
		expect(arbiterVisibilitySchema.properties.province.enum).toEqual([
			"Ontario",
			"Quebec",
			"British Columbia",
			"Alberta",
		]);
		const historicalInitialData = { country: "", state: "", province: "", region: "" };
		expect(arbiterVisibilityData).toEqual({ region: "" });
		expect(Object.keys(historicalInitialData).filter((key) => !(key in arbiterVisibilityData))).toEqual([
			"country",
			"state",
			"province",
		]);
		expect(arbiterVisibilityDemo.copy).toContain("renderer-owned blank placeholder");
		const selects = nodes(arbiterVisibilityDemo.sources[0].definition.root).filter(
			(node) => node.type === "field" && node.widget === "select",
		);
		expect(selects.map((node) => node.type === "field" && node.props?.options)).toEqual([
			undefined,
			undefined,
			undefined,
		]);
		expect(fields(arbiterVisibilityDemo.sources[0].definition)).toEqual([
			["country", "select", "Country"],
			["state", "select", "State"],
			["province", "select", "Province"],
			["region", "text", "Region"],
		]);
		expect(arbiterVisibilityRules.map((rule) => rule.name)).toEqual([
			"showUSState",
			"showCAProvince",
			"showOtherRegion",
		]);
	});

	it("retains demo 21's selector, all nine schema properties, and historical defaults", () => {
		expect(schemaProperties(arbiterSectionsSchema)).toEqual([
			"coverageType",
			"make",
			"model",
			"year",
			"address",
			"sqft",
			"yearBuilt",
			"age",
			"smoker",
			"conditions",
		]);
		expect(arbiterSectionsSchema.properties.coverageType.enum).toEqual(["auto", "home", "life"]);
		expect(arbiterSectionsData).toEqual({
			make: "",
			model: "",
			year: 0,
			address: "",
			sqft: 0,
			yearBuilt: 0,
			age: 0,
			smoker: false,
			conditions: "",
		});
		expect(Object.values(arbiterSectionsSchema.properties).map((property) => property.type)).toEqual([
			"string",
			"string",
			"string",
			"number",
			"string",
			"number",
			"number",
			"number",
			"boolean",
			"string",
		]);
	});

	it("retains demo 21's exact field widgets and three native section titles", () => {
		expect(fields(arbiterDynamicSectionsDemo.sources[0].definition).map(([path]) => path)).toEqual(
			schemaProperties(arbiterSectionsSchema),
		);
		expect(fields(arbiterDynamicSectionsDemo.sources[0].definition).map(([, widget]) => widget)).toEqual([
			"select",
			"text",
			"text",
			"number",
			"text",
			"number",
			"number",
			"number",
			"checkbox",
			"text",
		]);
		expect(
			nodes(arbiterDynamicSectionsDemo.sources[0].definition.root)
				.filter((node) => node.type === "section")
				.map((node) => node.title),
		).toEqual(["Vehicle Information", "Property Information", "Health Information"]);
	});
});

describe("released Arbiter policy transitions", () => {
	it("replaces US/CA/UK-DE visibility and releases all outputs on clear or unknown", () => {
		const form = createForm<Record<string, unknown>, Record<string, never>>({
			initialData: arbiterVisibilityData,
			initialUiState: {},
			plugins: [createArbiterPlugin({ rules: arbiterVisibilityRules })],
		});
		expect(policy(form)).toEqual({});
		for (const [country, expected] of [
			["US", { "/province": false, "/region": false, "/state": true }],
			["CA", { "/province": true, "/region": false, "/state": false }],
			["UK", { "/province": false, "/region": true, "/state": false }],
			["DE", { "/province": false, "/region": true, "/state": false }],
			["", {}],
			["unknown", {}],
		] as const) {
			form.setValue("country", country);
			expect(policy(form), country).toEqual(expected);
		}
		form.dispose();
	});

	it("atomically replaces auto/home/life required snapshots and clears without leaking", () => {
		const form = createForm<Record<string, unknown>, Record<string, never>>({
			initialData: arbiterSectionsData,
			initialUiState: {},
			plugins: [createArbiterPlugin({ rules: arbiterSectionsRules })],
		});
		const paths = ["make", "model", "year", "address", "sqft", "yearBuilt", "age", "smoker", "conditions"];
		expect(policy(form)).toEqual({});
		for (const [coverage, active] of [
			["auto", ["make", "model", "year"]],
			["home", ["address", "sqft", "yearBuilt"]],
			["life", ["age", "smoker", "conditions"]],
		] as const) {
			form.setValue("coverageType", coverage);
			expect(policy(form), coverage).toEqual(
				Object.fromEntries(paths.map((path) => [`/${path}`, active.includes(path as never)])),
			);
		}
		form.setValue("coverageType", "");
		expect(policy(form)).toEqual({});
		form.dispose();
		const isolated = createForm<Record<string, unknown>, Record<string, never>>({
			initialData: arbiterSectionsData,
			initialUiState: {},
			plugins: [createArbiterPlugin({ rules: arbiterSectionsRules })],
		});
		expect(policy(isolated)).toEqual({});
		isolated.dispose();
	});
});
