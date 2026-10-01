import type { FsxCompileOptions } from "@formbar/fsx-authoring";
import type { Node, Path } from "../runtime/kalada-demo-schema";

type Bindings = Pick<FsxCompileOptions, "references" | "locations" | "items">;
export interface FsxExample {
	readonly id: string;
	readonly title: string;
	readonly source: string;
	readonly data: Record<string, unknown>;
	readonly schema: Node;
	readonly paths: readonly Path[];
	readonly bindings: Bindings;
}
const string = { kind: "primitive-type", name: "string" } as const;
const json = { kind: "primitive-type", name: "json" } as const;
const ref = (name: string) => ({ namespace: "data" as const, segments: [name] });
const location = (name: string, type: typeof string | typeof json) => ({
	target: ref(name),
	type,
	writable: true as const,
});

export const fsxExamples: readonly FsxExample[] = [
	{
		id: "quote",
		title: "Reactive quote",
		source: `<Form id="quote" defaultLanguage="Kalada">
  <Field id="name" widget="text" label="Customer" value={name}/>
  <Field id="quantity" widget="number" label="Quantity" value={quantity}/>
  <Field id="unit-price" widget="number" label="Unit price" value={unitPrice}/>
  <Output id="total" label="Total" value={quantity == null || unitPrice == null ? "Enter both numbers" : quantity * unitPrice}/>
  <Conditional id="bulk" condition={quantity != null && quantity > 5}>
    <Output id="bulk-message" value={"Bulk order"}/>
  </Conditional>
</Form>`,
		data: { name: "Ada", quantity: 2, unitPrice: 12.5 },
		schema: {
			type: "object",
			additionalProperties: false,
			required: ["name", "quantity", "unitPrice"],
			properties: {
				name: { type: "string", minLength: 1 },
				quantity: { type: "number", minimum: 0 },
				unitPrice: { type: "number", minimum: 0 },
			},
		},
		paths: ["name", "quantity", "unitPrice"].map((name) => ({ path: [name], kind: "value" })),
		bindings: {
			references: {
				name: { reference: ref("name"), type: "dynamic" },
				quantity: { reference: ref("quantity"), type: "dynamic" },
				unitPrice: { reference: ref("unitPrice"), type: "dynamic" },
			},
			locations: {
				name: location("name", string),
				quantity: location("quantity", json),
				unitPrice: location("unitPrice", json),
			},
		},
	},
	{
		id: "line-items",
		title: "Writable line items",
		source: `<Form id="line-items" defaultLanguage="Kalada">
  <Repeater id="lines" value={rows} as="line">
    <Field id="description" widget="text" label="Description" value={line.description}/>
    <Field id="amount" widget="number" label="Amount" value={line.amount}/>
    <Output id="double" label="Double amount" value={rowAmount == null ? "Enter amount" : rowAmount * 2}/>
  </Repeater>
  <Repeater id="tags" value={tags} as="tagEntry">
    <Field id="tag" widget="text" label="Tag" value={(tagEntry)}/>
  </Repeater>
</Form>`,
		data: {
			rows: [
				{ description: "Design", amount: 20 },
				{ description: "Review", amount: 10 },
			],
			tags: ["urgent", "draft"],
		},
		schema: {
			type: "object",
			additionalProperties: false,
			required: ["rows", "tags"],
			properties: {
				rows: {
					type: "array",
					maxItems: 10,
					items: {
						type: "object",
						additionalProperties: false,
						required: ["description", "amount"],
						properties: {
							description: { type: "string", default: "New item" },
							amount: { type: "number", default: 0 },
						},
					},
				},
				tags: { type: "array", maxItems: 10, items: { type: "string", default: "new" } },
			},
		},
		paths: [
			{ path: ["rows"], kind: "array" },
			{ path: ["rows", { row: "line" }, "description"], kind: "value" },
			{ path: ["rows", { row: "line" }, "amount"], kind: "value" },
			{ path: ["tags"], kind: "array" },
			{ path: ["tags", { row: "tagEntry" }], kind: "value" },
		],
		bindings: {
			references: {
				rowAmount: { reference: { namespace: "data", scope: "line", segments: ["amount"] }, type: "dynamic" },
			},
			locations: { rows: location("rows", json), tags: location("tags", json) },
			items: {
				line: {
					target: { namespace: "data", scope: "line", segments: [] },
					type: json,
					writable: true,
					properties: { description: { type: string, writable: true }, amount: { type: json, writable: true } },
				},
				tagEntry: { target: { namespace: "data", scope: "tagEntry", segments: [] }, type: string, writable: true },
			},
		},
	},
];
export const fsxIds = fsxExamples.map(({ id }) => id);
