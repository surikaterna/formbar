import type { FormDefinition, FormNode } from "@formbar/declarative";
import type { SchemaDemoFixture } from "./baseline-contracts";

const half = { base: "full", md: 6 } as const;

function field(id: string, path: string, widget: string, label: string, span = false): FormNode {
	return {
		type: "field",
		id,
		binding: { namespace: "data", segments: [path] },
		widget,
		label,
		...(span ? { presentation: { span: half } } : {}),
	};
}

export const searchFiltersSchema = {
	type: "object",
	properties: {
		query: { type: "string", title: "Search", description: "Keywords or phrases" },
		category: {
			type: "string",
			title: "Category",
			enum: ["All", "Documents", "Images", "Videos", "Audio", "Archives"],
		},
		dateRange: {
			type: "string",
			title: "Date Range",
			enum: ["Any Time", "Past Hour", "Past Day", "Past Week", "Past Month", "Past Year"],
		},
		sortBy: {
			type: "string",
			title: "Sort By",
			enum: ["Relevance", "Date (Newest)", "Date (Oldest)", "Name (A-Z)", "Name (Z-A)", "Size"],
		},
		fileSize: { type: "string", title: "File Size", enum: ["Any", "< 1 MB", "1-10 MB", "10-100 MB", "> 100 MB"] },
		includeArchived: { type: "boolean", title: "Include Archived" },
		exactMatch: { type: "boolean", title: "Exact Match" },
	},
} as const;

export const searchFiltersDefinition = {
	version: 1,
	id: "search-filters",
	root: {
		type: "group",
		id: "root",
		children: [
			{
				type: "section",
				id: "search",
				title: "Search Query",
				children: [field("f-query", "query", "search", "Search")],
			},
			{
				type: "section",
				id: "filters",
				title: "Filters",
				children: [
					field("f-category", "category", "select", "Category", true),
					field("f-date-range", "dateRange", "select", "Date Range", true),
					field("f-sort-by", "sortBy", "select", "Sort By", true),
					field("f-file-size", "fileSize", "select", "File Size", true),
				],
			},
			{
				type: "section",
				id: "options",
				title: "Options",
				children: [
					field("f-archived", "includeArchived", "checkbox", "Include Archived", true),
					field("f-exact", "exactMatch", "checkbox", "Exact Match", true),
				],
			},
			{ type: "action", id: "apply", action: "demo11.apply-filters", concurrency: "drop", label: "Apply Filters" },
			{ type: "action", id: "reset", action: "reset", label: "Reset" },
		],
	},
} satisfies FormDefinition;

export const searchFiltersDemo = {
	id: "search-filters",
	title: "11. Search Filter Bar",
	subtitle: "Compact filter panel UI",
	copy: "A compact search and filter panel demonstrating formbar for non-traditional form UIs. Select components keep the interface clean, while switch toggles provide quick boolean options.",
	category: "layout",
	actionControls: "definition",
	runtimeProfileIds: ["demo11.search-actions.v1"],
	sources: [
		{
			key: "default",
			label: "Search filters schema",
			schema: searchFiltersSchema,
			definition: searchFiltersDefinition,
			initialData: {},
		},
	],
} as const satisfies SchemaDemoFixture;
