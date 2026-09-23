import type { Binding, FormDefinition, FormNode, JsonValue } from "@formbar/declarative";
import type { SchemaDemoFixture } from "./baseline-contracts";

const disabledBackendOption = Object.freeze({ value: "backend", title: "Back end", disabled: true });
const tagSchemaOptions = Object.freeze(["frontend", disabledBackendOption]);
const tagPresentationOptions = Object.freeze([
	Object.freeze({ value: "", title: "(empty tag)" }),
	Object.freeze({ value: "frontend", title: "frontend" }),
	disabledBackendOption,
]);
const roleOptions = Object.freeze([
	Object.freeze({ value: "lead", title: "Team lead" }),
	Object.freeze({ value: "developer", title: "Developer" }),
	Object.freeze({ value: "designer", title: "Designer" }),
	Object.freeze({ value: "qa", title: "Quality assurance" }),
]);

const binding = (path: string): Binding => ({ namespace: "data", segments: [path] });
const scoped = (scope: string, ...segments: string[]): Binding => ({ namespace: "data", segments, scope });
const literal = (value: JsonValue) => ({ kind: "literal" as const, value });

function field(id: string, target: Binding, widget: string, label: string): FormNode {
	return { type: "field", id, binding: target, widget, label };
}

function richOptionsField(id: string, target: Binding, label: string, options: JsonValue): FormNode {
	return {
		type: "field",
		id,
		binding: target,
		widget: "demo16.rich-select",
		label,
		props: { richOptions: { mode: "literal", value: options } },
	};
}

function rowActions(prefix: string, target: Binding): readonly FormNode[] {
	return [
		{
			type: "action",
			id: `${prefix}-up`,
			action: "array.move",
			target,
			label: "Move up",
			payload: literal({ offset: -1 }),
		},
		{
			type: "action",
			id: `${prefix}-down`,
			action: "array.move",
			target,
			label: "Move down",
			payload: literal({ offset: 1 }),
		},
		{ type: "action", id: `${prefix}-remove`, action: "array.remove", target, label: "Remove" },
	];
}

function repeater(
	id: string,
	path: string,
	label: string,
	children: readonly FormNode[],
	seed: JsonValue,
	limits: { readonly minItems?: number; readonly maxItems?: number } = {},
): readonly FormNode[] {
	const target = binding(path);
	return [
		{ type: "repeater", id, binding: target, scope: id, label, children, ...limits },
		{ type: "action", id: `${id}-add`, action: "array.append", target, label: `Add ${label}`, payload: literal(seed) },
	];
}

export const arrayItemsSchema = {
	type: "object",
	required: ["projectName"],
	properties: {
		projectName: { type: "string", title: "Project Name" },
		description: { type: "string", title: "Description", "x-formbar": { widget: "textarea" } },
		priority: { type: "string", title: "Priority", enum: ["Low", "Medium", "High", "Critical"] },
		tags: {
			type: "array",
			title: "Tags",
			uniqueItems: true,
			maxItems: 2,
			items: {
				type: "string",
				"x-formbar": { options: tagSchemaOptions },
			},
		},
		teamMembers: {
			type: "array",
			title: "Team Members",
			items: {
				type: "object",
				properties: {
					name: { type: "string", title: "Name" },
					role: {
						type: "string",
						title: "Role",
						enum: ["lead", "developer", "designer", "qa"],
						"x-formbar": { options: roleOptions },
					},
					email: { type: "string", title: "Email" },
				},
			},
		},
		addresses: {
			type: "array",
			title: "Office Locations",
			items: {
				type: "object",
				properties: {
					label: { type: "string", title: "Label", enum: ["HQ", "Branch", "Remote", "Warehouse"] },
					street: { type: "string", title: "Street Address" },
					city: { type: "string", title: "City" },
					state: { type: "string", title: "State/Province" },
					postalCode: { type: "string", title: "Postal Code" },
					country: { type: "string", title: "Country" },
					isPrimary: { type: "boolean", title: "Primary Location" },
				},
			},
		},
		milestones: {
			type: "array",
			title: "Milestones",
			items: {
				type: "object",
				properties: {
					title: { type: "string", title: "Milestone" },
					dueDate: { type: "string", title: "Due Date" },
					completed: { type: "boolean", title: "Completed" },
				},
			},
		},
		isPublic: { type: "boolean", title: "Public Project", description: "Visible to all organization members" },
	},
} as const;

const tags = binding("tags");
const team = binding("teamMembers");
const addresses = binding("addresses");
const milestones = binding("milestones");

export const arrayItemsDefinition = {
	version: 1,
	id: "array-items",
	root: {
		type: "group",
		id: "root",
		children: [
			field("f-project-name", binding("projectName"), "text", "Project Name"),
			field("f-description", binding("description"), "textarea", "Description"),
			field("f-priority", binding("priority"), "radio", "Priority"),
			...repeater(
				"tags",
				"tags",
				"Tags",
				[richOptionsField("f-tag", scoped("tags"), "Tag", tagPresentationOptions), ...rowActions("tag", tags)],
				"",
				{ maxItems: 2 },
			),
			...repeater(
				"team-members",
				"teamMembers",
				"Team Members",
				[
					field("f-member-name", scoped("team-members", "name"), "text", "Name"),
					richOptionsField("f-member-role", scoped("team-members", "role"), "Role", roleOptions),
					field("f-member-email", scoped("team-members", "email"), "email", "Email"),
					...rowActions("member", team),
				],
				{},
			),
			...repeater(
				"addresses",
				"addresses",
				"Office Locations",
				[
					field("f-address-label", scoped("addresses", "label"), "select", "Label"),
					field("f-address-street", scoped("addresses", "street"), "text", "Street Address"),
					field("f-address-city", scoped("addresses", "city"), "text", "City"),
					field("f-address-state", scoped("addresses", "state"), "text", "State/Province"),
					field("f-address-postal", scoped("addresses", "postalCode"), "text", "Postal Code"),
					field("f-address-country", scoped("addresses", "country"), "text", "Country"),
					field("f-address-primary", scoped("addresses", "isPrimary"), "checkbox", "Primary Location"),
					...rowActions("address", addresses),
				],
				{},
			),
			...repeater(
				"milestones",
				"milestones",
				"Milestones",
				[
					field("f-milestone-title", scoped("milestones", "title"), "text", "Milestone"),
					field("f-milestone-due", scoped("milestones", "dueDate"), "text", "Due Date"),
					field("f-milestone-completed", scoped("milestones", "completed"), "checkbox", "Completed"),
					...rowActions("milestone", milestones),
				],
				{},
			),
			field("f-public", binding("isPublic"), "checkbox", "Public Project"),
			{ type: "action", id: "submit", action: "submit", label: "Submit" },
			{ type: "action", id: "reset", action: "reset", label: "Reset" },
		],
	},
} satisfies FormDefinition;

export const arrayItemsData = { tags: [], teamMembers: [], addresses: [], milestones: [] } as const;

export const arrayItemsDemo = {
	id: "array-items",
	title: "8. Array/Repeatable Items",
	subtitle: "Repeatable fields and object arrays",
	copy: "Shows how formbar handles array fields in JSON Schema. Simple arrays, object arrays, and nested structures are all supported. Array items render with schema-aware controls including enums, booleans, and text inputs.",
	category: "sources",
	actionControls: "definition",
	runtimeProfileIds: ["demo16.trusted-widgets.v1"],
	sources: [
		{
			key: "default",
			label: "Array items schema",
			schema: arrayItemsSchema,
			definition: arrayItemsDefinition,
			initialData: arrayItemsData,
		},
	],
} as const satisfies SchemaDemoFixture;
