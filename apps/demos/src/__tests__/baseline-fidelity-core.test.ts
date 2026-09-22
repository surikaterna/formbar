import { describe, expect, it } from "vitest";
import { basicContactDemo } from "../demos/01-basic-contact";
import { userProfileDemo } from "../demos/02-user-profile";
import { nestedAddressDemo } from "../demos/03-nested-address";
import { settingsPanelDemo } from "../demos/04-settings-panel";
import { productEntryDemo } from "../demos/05-product-entry";
import { definitionSummary, objectSchema, onlySource, requiredDefinition } from "./baseline-fidelity-helpers";

const half = { base: "full", md: 6 };
const profileDefinitionSummary = [
	{
		id: "personal",
		title: "Personal Information",
		fields: [
			{ id: "f-firstName", path: "firstName", widget: "text", label: "First Name", span: half },
			{ id: "f-lastName", path: "lastName", widget: "text", label: "Last Name", span: half },
			{ id: "f-email", path: "email", widget: "email", label: "Email", span: half },
			{ id: "f-age", path: "age", widget: "number", label: "Age", span: half },
		],
	},
	{
		id: "work",
		title: "Work Details",
		fields: [
			{ id: "f-role", path: "role", widget: "select", label: "Role", span: half },
			{ id: "f-department", path: "department", widget: "select", label: "Department", span: half },
		],
	},
	{
		id: "preferences",
		title: "Preferences",
		fields: [
			{ id: "f-bio", path: "bio", widget: "textarea", label: "Bio", span: undefined },
			{
				id: "f-newsletter",
				path: "newsletter",
				widget: "checkbox",
				label: "Subscribe to Newsletter",
				span: undefined,
			},
		],
	},
];

const productDefinitionSummary = [
	["identity", "Product Identity", ["name", "sku", "category"]],
	["details", "Details", ["description"]],
	["pricing", "Pricing & Inventory", ["price", "weight", "quantity", "rating"]],
	["status", "Status", ["isActive", "isFeatured"]],
];

describe("baseline fixture fidelity: demos 1-5", () => {
	it("restores demo 1 contact fields and annotations exactly", () => {
		const source = onlySource(basicContactDemo);
		const schema = objectSchema(source);
		expect(schema.required).toEqual(["name", "email"]);
		expect(schema.properties).toEqual({
			name: { type: "string", title: "Full Name", description: "Your full legal name" },
			email: { type: "string", title: "Email", format: "email", description: "We will never share your email" },
			phone: { type: "string", title: "Phone Number" },
			message: { type: "string", title: "Message", maxLength: 500, "x-formbar": { widget: "textarea" } },
		});
		expect(source.definition).toBeUndefined();
		expect(source.initialData).toEqual({});
	});

	it("restores demo 2 profile fields, options, bounds, and canonical layout paths", () => {
		const source = onlySource(userProfileDemo);
		const schema = objectSchema(source);
		expect(schema.required).toEqual(["firstName", "lastName", "email", "role"]);
		expect(schema.properties).toEqual({
			firstName: { type: "string", title: "First Name" },
			lastName: { type: "string", title: "Last Name" },
			email: { type: "string", title: "Email", format: "email" },
			age: { type: "integer", title: "Age", minimum: 18, maximum: 120 },
			role: { type: "string", title: "Role", enum: ["Developer", "Designer", "Manager", "QA", "DevOps"] },
			department: {
				type: "string",
				title: "Department",
				enum: ["Engineering", "Product", "Marketing", "Sales", "HR", "Finance", "Legal", "Operations"],
			},
			bio: { type: "string", title: "Bio", maxLength: 500, description: "Tell us about yourself" },
			newsletter: { type: "boolean", title: "Subscribe to Newsletter", description: "Receive weekly updates" },
		});
		expect(definitionSummary(requiredDefinition(source))).toEqual(profileDefinitionSummary);
		expect(source.initialData).toEqual({});
	});

	it("restores demo 3 top-level identity and both complete address shapes", () => {
		const source = onlySource(nestedAddressDemo);
		const schema = objectSchema(source);
		const country = {
			type: "string",
			title: "Country",
			enum: ["United States", "Canada", "United Kingdom", "Germany", "France", "Australia", "Japan", "Other"],
		};
		const address = (title: string) => ({
			type: "object",
			title,
			properties: {
				street: { type: "string", title: "Street" },
				city: { type: "string", title: "City" },
				state: { type: "string", title: "State/Province" },
				zipCode: { type: "string", title: "Zip/Postal Code" },
				country,
			},
		});
		expect(schema.required).toEqual(["name", "email"]);
		expect(schema.properties).toEqual({
			name: { type: "string", title: "Full Name" },
			email: { type: "string", title: "Email", format: "email" },
			homeAddress: address("Home Address"),
			workAddress: address("Work Address"),
		});
		const definition = requiredDefinition(source);
		if (definition.root.type !== "group") throw new Error("Expected a root group");
		expect(definition.root.children.map((node) => node.id)).toEqual([
			"f-name",
			"f-email",
			"home-address",
			"work-address",
		]);
		expect(source.initialData).toEqual({});
	});

	it("restores all ten demo 4 settings and original option order", () => {
		const source = onlySource(settingsPanelDemo);
		const schema = objectSchema(source);
		expect(schema.required).toBeUndefined();
		expect(schema.properties).toEqual({
			notifications: { type: "boolean", title: "Enable Notifications", description: "Receive in-app notifications" },
			emailAlerts: { type: "boolean", title: "Email Alerts", description: "Send email for important events" },
			pushNotifications: { type: "boolean", title: "Push Notifications", description: "Mobile push notifications" },
			darkMode: { type: "boolean", title: "Dark Mode", description: "Use dark color theme" },
			compactView: { type: "boolean", title: "Compact View", description: "Reduce spacing in lists" },
			fontSize: {
				type: "integer",
				title: "Font Size",
				minimum: 12,
				maximum: 24,
				description: "Base font size in pixels",
			},
			language: { type: "string", title: "Language", enum: ["English", "Spanish", "French", "German", "Japanese"] },
			timezone: {
				type: "string",
				title: "Time Zone",
				enum: ["UTC-8 (PST)", "UTC-5 (EST)", "UTC+0 (GMT)", "UTC+1 (CET)", "UTC+9 (JST)", "UTC+10 (AEST)"],
			},
			autoSave: { type: "boolean", title: "Auto-Save", description: "Automatically save changes" },
			telemetry: {
				type: "boolean",
				title: "Usage Analytics",
				description: "Help us improve by sharing anonymous usage data",
			},
		});
		expect(
			definitionSummary(requiredDefinition(source)).map((section) => [
				section.id,
				section.title,
				section.fields.map((field) => field.path),
			]),
		).toEqual([
			["notifications", "Notifications", ["notifications", "emailAlerts", "pushNotifications"]],
			["appearance", "Appearance", ["darkMode", "compactView", "fontSize"]],
			["localization", "Localization", ["language", "timezone"]],
			["data", "Data & Privacy", ["autoSave", "telemetry"]],
		]);
		expect(source.initialData).toEqual({});
	});

	it("restores all ten demo 5 product fields, constraints, and sections", () => {
		const source = onlySource(productEntryDemo);
		const schema = objectSchema(source);
		expect(schema.required).toEqual(["name", "sku", "price", "category"]);
		expect(schema.properties).toEqual({
			name: { type: "string", title: "Product Name", description: "Display name shown to customers" },
			sku: { type: "string", title: "SKU", description: "Stock Keeping Unit identifier" },
			description: {
				type: "string",
				title: "Description",
				maxLength: 1000,
				description: "Detailed product description",
				"x-formbar": { widget: "textarea" },
			},
			category: {
				type: "string",
				title: "Category",
				enum: [
					"Electronics",
					"Clothing",
					"Home & Garden",
					"Sports",
					"Books",
					"Food & Beverage",
					"Health",
					"Automotive",
					"Toys",
					"Office Supplies",
				],
			},
			price: { type: "number", title: "Price (USD)", minimum: 0, description: "Retail price" },
			weight: { type: "number", title: "Weight (kg)", minimum: 0, description: "Shipping weight" },
			quantity: { type: "integer", title: "Stock Quantity", minimum: 0, maximum: 10000, description: "Units in stock" },
			rating: {
				type: "integer",
				title: "Quality Rating",
				minimum: 1,
				maximum: 5,
				description: "Internal quality score",
			},
			isActive: { type: "boolean", title: "Active", description: "Available for purchase" },
			isFeatured: { type: "boolean", title: "Featured", description: "Show on homepage" },
		});
		expect(
			definitionSummary(requiredDefinition(source)).map((section) => [
				section.id,
				section.title,
				section.fields.map((field) => field.path),
			]),
		).toEqual(productDefinitionSummary);
		expect(source.initialData).toEqual({});
	});
});
