import type {
	DefinitionProgram as Expression,
	FormDefinition,
	FormNode,
	JsonValue,
	ResponsiveSpan,
} from "@formbar/declarative";
import { dataRef, jsonDefault, literal, numeric, uiRef } from "./kalada-fixture-programs";

const half = { base: "full", md: 6 } as const;
const lineItems = { namespace: "data" as const, segments: ["lineItems"] };
const valueOrZero = (path: string) => jsonDefault(dataRef(path), literal(0));

function field(id: string, path: string, widget: string, label: string, span?: ResponsiveSpan): FormNode {
	return {
		type: "field",
		id,
		binding: { namespace: "data", segments: [path] },
		widget,
		label,
		...(span ? { presentation: { span } } : {}),
	};
}

function scopedField(id: string, path: string, widget: string, label: string): FormNode {
	return {
		type: "field",
		id,
		binding: { namespace: "data", segments: [path], scope: "line-items" },
		widget,
		label,
	};
}

function lineAction(id: string, action: string, label: string, payload?: JsonValue): FormNode {
	return {
		type: "action",
		id,
		action,
		label,
		target: lineItems,
		...(payload === undefined ? {} : { payload: literal(payload) }),
	};
}

const subtotalExpression = uiRef("lineSubtotal");
const taxExpression = numeric("multiply", subtotalExpression, numeric("divide", valueOrZero("taxRate"), literal(100)));
const discountExpression = numeric(
	"multiply",
	subtotalExpression,
	numeric("divide", valueOrZero("discount"), literal(100)),
);
const totalExpression = numeric(
	"subtract",
	numeric("add", numeric("add", subtotalExpression, taxExpression), valueOrZero("shippingCost")),
	discountExpression,
);

function output(id: string, label: string, value: Expression): FormNode {
	return { type: "output", id, label, value, format: "number", presentation: { span: half } };
}

const lineItemNodes: readonly FormNode[] = [
	scopedField("f-line-description", "description", "text", "Description"),
	scopedField("f-line-amount", "amount", "number", "Amount"),
	lineAction("line-up", "array.move", "Move up", { offset: -1 }),
	lineAction("line-down", "array.move", "Move down", { offset: 1 }),
	lineAction("line-remove", "array.remove", "Remove"),
];

export const orderEntryDefinition = {
	version: 1,
	id: "order-entry",
	root: {
		type: "group",
		id: "root",
		children: [
			{
				type: "section",
				id: "header",
				title: "Order Header",
				children: [
					field("f-order-num", "orderNumber", "text", "Order Number", half),
					field("f-order-date", "orderDate", "date", "Order Date", half),
					field("f-delivery-date", "deliveryDate", "date", "Requested Delivery Date", half),
					field("f-rush", "rushOrder", "checkbox", "Rush Order", half),
				],
			},
			{
				type: "section",
				id: "customer",
				title: "Customer",
				children: [
					field("f-name", "customerName", "text", "Customer Name", half),
					field("f-email", "customerEmail", "email", "Customer Email", half),
				],
			},
			{
				type: "section",
				id: "payment",
				title: "Payment & Pricing",
				children: [
					field("f-payment", "paymentMethod", "select", "Payment Method", half),
					field("f-currency", "currency", "select", "Currency", half),
					{
						type: "repeater",
						id: "line-items",
						binding: lineItems,
						scope: "line-items",
						label: "Line Items",
						children: lineItemNodes,
						minItems: 1,
						maxItems: 20,
					},
					lineAction("line-add", "array.append", "Add Line Item", {}),
					field("f-tax", "taxRate", "number", "Tax Rate (%)", half),
					field("f-discount", "discount", "number", "Discount (%)", half),
					field("f-shipping", "shippingCost", "number", "Shipping Cost", half),
					output("subtotal-output", "Subtotal", subtotalExpression),
					output("tax-output", "Tax Amount", taxExpression),
					output("discount-output", "Discount Amount", discountExpression),
					output("total-output", "Total", totalExpression),
				],
			},
			{
				type: "section",
				id: "delivery",
				title: "Delivery Options",
				children: [field("f-signature", "requiresSignature", "checkbox", "Requires Signature", half)],
			},
			{
				type: "section",
				id: "notes",
				title: "Notes",
				children: [field("f-notes", "notes", "textarea", "Order Notes")],
			},
			{ type: "action", id: "submit", action: "submit", label: "Submit" },
			{ type: "action", id: "reset", action: "reset", label: "Reset" },
		],
	},
} satisfies FormDefinition;
