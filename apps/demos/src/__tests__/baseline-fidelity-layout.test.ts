import { describe, expect, it } from "vitest";
import { customLayoutDemo } from "../demos/09-custom-layout";
import { responsiveSectionsDemo } from "../demos/10-multi-section-responsive";
import { multiSchemaSourcesDemo } from "../demos/13-multi-schema-sources";
import { kitchenSinkDemo } from "../demos/15-kitchen-sink";
import {
	explicitSourceDefinition,
	kitchenDefinition,
	minimalSourceDefinition,
	responsiveDefinition,
	vesselDefinition,
} from "./baseline-definition-expectations-layout";
import { definitionStructure, objectSchema, onlySource, requiredDefinition } from "./baseline-fidelity-helpers";

const kitchenSinkProperties = {
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
};

describe("baseline fixture fidelity: demos 9, 10, 13, and 15", () => {
	it("restores all twelve vessel fields, options, bounds, and layout paths", () => {
		const source = onlySource(customLayoutDemo);
		const schema = objectSchema(source);
		expect(schema.required).toEqual(["vesselName", "imoNumber"]);
		expect(schema.properties).toEqual({
			vesselName: { type: "string", title: "Vessel Name" },
			imoNumber: { type: "string", title: "IMO Number", description: "International Maritime Organization number" },
			callSign: { type: "string", title: "Call Sign" },
			flag: {
				type: "string",
				title: "Flag State",
				enum: [
					"Panama",
					"Liberia",
					"Marshall Islands",
					"Hong Kong",
					"Singapore",
					"Bahamas",
					"Malta",
					"Norway",
					"Greece",
					"Japan",
				],
			},
			vesselType: {
				type: "string",
				title: "Vessel Type",
				enum: ["Container", "Bulk Carrier", "Tanker", "RoRo", "General Cargo"],
			},
			grossTonnage: { type: "number", title: "Gross Tonnage", minimum: 0, description: "GT" },
			deadweight: { type: "number", title: "Deadweight", minimum: 0, description: "DWT in metric tons" },
			length: { type: "number", title: "LOA (m)", minimum: 0, description: "Length Overall in meters" },
			beam: { type: "number", title: "Beam (m)", minimum: 0, description: "Width at widest point" },
			draft: { type: "number", title: "Max Draft (m)", minimum: 0, description: "Maximum draft" },
			yearBuilt: { type: "integer", title: "Year Built", minimum: 1950, maximum: 2026 },
			isActive: { type: "boolean", title: "Active", description: "Currently in service" },
		});
		expect(definitionStructure(requiredDefinition(source))).toEqual(vesselDefinition);
		expect(source.initialData).toEqual({});
	});

	it("restores the complete passenger domain with truthful date, tel, and typed span output", () => {
		const source = onlySource(responsiveSectionsDemo);
		const schema = objectSchema(source);
		expect(schema.required).toEqual(["firstName", "lastName"]);
		expect(schema.properties).toEqual({
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
		});
		expect(definitionStructure(requiredDefinition(source))).toEqual(responsiveDefinition);
		expect(source.initialData).toEqual({});
	});

	it("restores both demo 13 source examples over the same five canonical fields", () => {
		const [minimalSource, explicitSource] = multiSchemaSourcesDemo.sources;
		const minimal = objectSchema(minimalSource);
		const explicit = objectSchema(explicitSource);
		expect(minimal.required).toBeUndefined();
		expect(minimal.properties).toEqual({
			name: { type: "string" },
			email: { type: "string", format: "email" },
			age: { type: "integer" },
			role: { type: "string", enum: ["Admin", "User", "Guest"] },
			active: { type: "boolean" },
		});
		expect(explicit.required).toEqual(["name", "email", "role"]);
		expect(explicit.properties).toEqual({
			name: {
				type: "string",
				title: "Full Name",
				description: "Your complete name as it appears on official documents",
				minLength: 2,
				maxLength: 100,
			},
			email: { type: "string", title: "Email Address", format: "email", description: "Primary contact email" },
			age: { type: "integer", title: "Age", minimum: 0, maximum: 150, description: "Your age in years" },
			role: {
				type: "string",
				title: "User Role",
				enum: ["Admin", "User", "Guest"],
				description: "Access level in the system",
			},
			active: { type: "boolean", title: "Account Active", description: "Enable or disable this account" },
		});
		expect(definitionStructure(requiredDefinition(minimalSource))).toEqual(minimalSourceDefinition);
		expect(definitionStructure(requiredDefinition(explicitSource))).toEqual(explicitSourceDefinition);
		expect(minimalSource.initialData).toEqual({});
		expect(explicitSource.initialData).toEqual({});
	});

	it("restores demo 15 fields, options, bounds, requiredness, and initial example", () => {
		const source = onlySource(kitchenSinkDemo);
		const schema = objectSchema(source);
		expect(schema.required).toEqual(["textField", "emailField", "selectSmall", "selectLarge", "requiredField"]);
		expect(schema.properties).toEqual(kitchenSinkProperties);
		expect(definitionStructure(requiredDefinition(source))).toEqual(kitchenDefinition);
		expect(source.initialData).toEqual({ selectSmall: "legacy", withDefault: "Hello, ARB!" });
	});
});
