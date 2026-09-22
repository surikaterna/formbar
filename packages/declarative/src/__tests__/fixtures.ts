import type { Expression, FormDefinition, FormNode, StateRef } from "../index.js";

export const literal = (value: string | number | boolean | null): Expression => ({ kind: "literal", value });
export const ref = (segments: readonly (string | number)[], scope?: string): Expression => ({
	kind: "ref",
	ref: { namespace: "data", segments, ...(scope ? { scope } : {}) },
});
export const binding = (segments: readonly (string | number)[], scope?: string): StateRef => ({
	namespace: "data",
	segments,
	...(scope ? { scope } : {}),
});

const variants: readonly FormNode[] = [
	{
		type: "section",
		id: "profile",
		title: "Profile",
		description: "Contact details",
		children: [{ type: "field", id: "name", binding: binding(["name"]), widget: "text", label: "Name" }],
	},
	{
		type: "repeater",
		id: "orders",
		binding: binding(["orders"]),
		scope: "order",
		minItems: 0,
		maxItems: 10,
		children: [
			{
				type: "repeater",
				id: "lines",
				binding: binding(["lines"], "order"),
				scope: "line",
				children: [
					{
						type: "field",
						id: "sku",
						binding: binding(["sku"], "line"),
						widget: "sku-picker",
						props: { label: { mode: "read", expression: ref(["sku"], "line") } },
					},
				],
			},
		],
	},
	{
		type: "action",
		id: "save",
		action: "save-form",
		label: "Save",
		payload: ref(["name"]),
		props: { tone: { mode: "literal", value: "primary" } },
	},
	{ type: "output", id: "summary", value: ref(["name"]), label: "Summary", format: "plain" },
	{
		type: "conditional",
		id: "details",
		condition: literal(true),
		// biome-ignore lint/suspicious/noThenProperty: This fixture exercises the serialized conditional branch.
		then: [{ type: "custom", id: "map", renderer: "address-map", props: { zoom: { mode: "literal", value: 4 } } }],
		else: [{ type: "validation", id: "name-errors", binding: binding(["name"]), messages: ["Required"] }],
	},
	{
		type: "tabs",
		id: "tabs",
		tabs: [{ id: "tab-main", label: "Main", children: [{ type: "group", id: "tab-group", children: [] }] }],
	},
	{
		type: "accordion",
		id: "accordion",
		items: [{ id: "panel-help", label: "Help", children: [{ type: "group", id: "help-group", children: [] }] }],
	},
];

export const completeDefinition = (): FormDefinition => ({
	version: 1,
	id: "customer-form",
	root: {
		type: "group",
		id: "root",
		visible: literal(true),
		disabled: literal(false),
		readOnly: literal(false),
		presentation: { span: { base: "full", md: 8 } },
		children: [...variants],
	},
	computations: [
		{
			id: "total",
			target: binding(["total"]),
			expression: { kind: "op", op: "add", args: [ref(["subtotal"]), literal(1)] },
		},
	],
});
