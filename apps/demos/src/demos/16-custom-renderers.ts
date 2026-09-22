import type { FormDefinition, FormNode, JsonValue } from "@formbar/declarative";
import { customWidgetProfile } from "../extensions/custom-widget-profile";
import type { SchemaDemoFixture } from "./baseline-contracts";

const brightColors = Object.freeze([
	"#3B82F6",
	"#EF4444",
	"#10B981",
	"#F59E0B",
	"#8B5CF6",
	"#EC4899",
	"#06B6D4",
	"#F97316",
]);
const slateColors = Object.freeze([
	"#1E293B",
	"#334155",
	"#475569",
	"#64748B",
	"#94A3B8",
	"#CBD5E1",
	"#E2E8F0",
	"#F8FAFC",
]);
const tags = Object.freeze(["Performance", "Usability", "Design", "Reliability", "Security"]);

function ratingProperties(qualityWidget: string) {
	return {
		qualityRating: {
			type: "integer",
			title: "Quality Rating",
			minimum: 0,
			maximum: 5,
			multipleOf: 1,
			"x-formbar": { widget: qualityWidget, props: { icon: "star" } },
			description: "Click stars to rate",
		},
		userSatisfaction: {
			type: "integer",
			title: "User Satisfaction",
			minimum: 0,
			maximum: 5,
			multipleOf: 1,
			"x-formbar": { widget: "demo16.rating", props: { icon: "star" } },
		},
	};
}

function choiceProperties() {
	return {
		brandColor: {
			type: "string",
			title: "Brand Color",
			pattern: "^#[0-9a-fA-F]{6}$",
			enum: brightColors,
			"x-formbar": { widget: "demo16.color" },
			description: "Pick a brand color",
		},
		accentColor: {
			type: "string",
			title: "Accent Color",
			pattern: "^#[0-9a-fA-F]{6}$",
			enum: slateColors,
			"x-formbar": { widget: "demo16.color" },
		},
		tags: {
			type: "array",
			title: "Tags",
			items: { type: "string", enum: tags },
			uniqueItems: true,
			"x-formbar": { widget: "demo16.checkbox-group" },
			description: "Select all that apply",
		},
	};
}

function completionProperties() {
	return {
		completionRate: {
			type: "integer",
			title: "Completion Rate",
			minimum: 0,
			maximum: 100,
			multipleOf: 1,
			"x-formbar": { widget: "demo16.progress" },
			description: "Project completion percentage",
		},
		notes: { type: "string", title: "Notes", "x-formbar": { widget: "textarea" } },
	};
}

function properties(qualityWidget: string) {
	return {
		productName: { type: "string", title: "Product Name" },
		...ratingProperties(qualityWidget),
		...choiceProperties(),
		...completionProperties(),
	};
}

function literal(value: JsonValue) {
	return { mode: "literal" as const, value };
}

function field(
	id: string,
	path: string,
	widget: string,
	label: string,
	props?: Readonly<Record<string, JsonValue>>,
): FormNode {
	return {
		type: "field",
		id,
		binding: { namespace: "data", segments: [path] },
		widget,
		label,
		...(props ? { props: Object.fromEntries(Object.entries(props).map(([key, value]) => [key, literal(value)])) } : {}),
	};
}

const authoredDefinition = {
	version: 1,
	id: "demo16-authored-overrides",
	root: {
		type: "group",
		id: "root",
		children: [
			field("f-product-name", "productName", "text", "Product Name"),
			field("f-quality-rating", "qualityRating", "demo16.rating", "Quality Rating", { icon: "heart" }),
			field("f-user-satisfaction", "userSatisfaction", "demo16.rating", "User Satisfaction", { icon: "star" }),
			field("f-brand-color", "brandColor", "demo16.color", "Brand Color"),
			field("f-accent-color", "accentColor", "demo16.color", "Accent Color"),
			field("f-tags", "tags", "demo16.checkbox-group", "Tags"),
			field("f-completion-rate", "completionRate", "demo16.range", "Completion Rate"),
			field("f-notes", "notes", "textarea", "Notes"),
		],
	},
} satisfies FormDefinition;

const diagnosticsDefinition = {
	version: 1,
	id: "demo16-extension-diagnostics",
	root: {
		type: "group",
		id: "diagnostic-root",
		children: [
			field("missing-widget", "missingWidget", "demo16.missing-widget", "Missing widget"),
			{
				type: "custom",
				id: "missing-node",
				renderer: "demo16.missing-node",
				props: { note: literal("Safe missing-node evidence") },
				children: [],
			},
		],
	},
} satisfies FormDefinition;

const initialData = Object.freeze({
	productName: "",
	qualityRating: 0,
	userSatisfaction: 0,
	brandColor: "",
	accentColor: "",
	tags: Object.freeze([]),
	completionRate: 0,
	notes: "",
});

export const customRenderersDemo: SchemaDemoFixture = Object.freeze({
	id: "custom-renderers",
	title: "16. Custom Renderers",
	subtitle: "Trusted widgets selected by serializable IDs",
	copy: "Demonstrates custom field renderers using x-formbar metadata extensions. Star ratings, color pickers, checkbox groups, and progress bars — all driven by schema metadata.",
	category: "sources",
	runtimeProfile: customWidgetProfile,
	sources: Object.freeze([
		Object.freeze({
			key: "schema-hints",
			label: "Schema hints",
			schema: Object.freeze({ type: "object", properties: properties("demo16.rating") }),
			initialData,
		}),
		Object.freeze({
			key: "authored-overrides",
			label: "Authored overrides",
			schema: Object.freeze({ type: "object", properties: properties("demo16.color") }),
			definition: authoredDefinition,
			initialData,
		}),
		Object.freeze({
			key: "extension-diagnostics",
			label: "Extension diagnostics (opt-in)",
			schema: Object.freeze({
				type: "object",
				properties: { missingWidget: { type: "string", title: "Missing widget" } },
			}),
			definition: diagnosticsDefinition,
			initialData: Object.freeze({ missingWidget: "" }),
		}),
	] as const),
});
