import { createForm } from "@formbar/core";
import type { FormNode } from "@formbar/declarative";
import { createSchemaForm, jsonSchemaProvider } from "@formbar/from-schema";
import { FormRenderer } from "@formbar/react-schema";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { richValidationSchema } from "../demos/06-rich-validation";
import { arrayItemsSchema } from "../demos/08-array-items";
import { searchFiltersDefinition, searchFiltersSchema } from "../demos/11-search-filters";
import { orderEntrySchema } from "../demos/14-order-entry";
import { arbiterCalculatedData, arbiterCalculatedUiState } from "../demos/19-arbiter-calculated";
import { arbiterValidationData, arbiterValidationSchema } from "../demos/20-arbiter-validation-gating";
import { demos } from "../demos/index";

const ids = [
	"rich-validation",
	"array-items",
	"search-filters",
	"order-entry",
	"arbiter-calculated",
	"arbiter-validation-gating",
] as const;
const provider = jsonSchemaProvider({ dialect: "draft-2020-12" });

function fixture(id: (typeof ids)[number]) {
	const value = demos.find((demo) => demo.id === id)?.fixture;
	if (!value) throw new Error(`Missing fixture ${id}`);
	return value;
}

function definition(id: (typeof ids)[number]) {
	const value = fixture(id).sources[0].definition;
	if (!value) throw new Error(`Missing definition ${id}`);
	return value;
}

function nodes(node: FormNode): readonly FormNode[] {
	if (node.type === "group" || node.type === "section" || node.type === "repeater")
		return [node, ...node.children.flatMap(nodes)];
	if (node.type === "conditional") return [node, ...node.then.flatMap(nodes), ...(node.else ?? []).flatMap(nodes)];
	return [node];
}

describe("runtime demo architecture", () => {
	it("registers the historical routes in exact numeric order with complete handoff metadata", () => {
		expect(demos.slice(0, 21).map((demo) => demo.id)).toEqual([
			"basic-contact",
			"user-profile",
			"nested-address",
			"settings-panel",
			"product-entry",
			"rich-validation",
			"conditional-fields",
			"array-items",
			"custom-layout",
			"multi-section-responsive",
			"search-filters",
			"survey",
			"multi-schema-sources",
			"order-entry",
			"kitchen-sink",
			"custom-renderers",
			"custom-layout-types",
			"arbiter-visibility",
			"arbiter-calculated",
			"arbiter-validation-gating",
			"arbiter-dynamic-sections",
		]);
		for (const id of ids) {
			const registered = fixture(id);
			expect(registered.actionControls, id).toBe("definition");
			expect(registered.sources, id).toHaveLength(1);
			expect(registered.sources[0].key, id).toBe("default");
			expect(registered.sources[0].definition, id).toBeDefined();
		}
		expect(fixture("search-filters").runtimeProfile?.id).toBe("demo11.search-actions.v1");
		expect(fixture("search-filters").runtimeProfile?.actions?.map((action) => action.id)).toEqual([
			"demo11.apply-filters",
		]);
		expect(fixture("arbiter-calculated").sources[0].arbiterRules).toBeDefined();
		expect(fixture("arbiter-validation-gating").sources[0].arbiterRules).toBeDefined();
	});

	it("round-trips and compiles every authored fixture without definition diagnostics", () => {
		for (const id of ids) {
			const source = fixture(id).sources[0];
			expect(JSON.parse(JSON.stringify(source.schema)), id).toEqual(source.schema);
			expect(JSON.parse(JSON.stringify(source.definition)), id).toEqual(source.definition);
			const prepared = createSchemaForm(source.schema, {
				provider,
				side: "input",
				definition: source.definition,
			});
			expect(prepared.diagnostics.definition, id).toEqual([]);
		}
	});

	it("preserves validation, repeater, filter, order, and Arbiter fixture fidelity", () => {
		const validation = richValidationSchema;
		expect(Object.keys(validation.properties)).toEqual(["username", "email", "password", "age", "website", "score"]);
		expect(validation.required).toEqual(["username", "email", "password", "age", "website"]);
		expect(validation.properties.username).toMatchObject({ minLength: 3, maxLength: 20, pattern: "^[a-zA-Z0-9_]+$" });
		expect(validation.properties.age).toMatchObject({ type: "integer", minimum: 13, maximum: 150 });
		expect(validation.properties.website.format).toBe("uri");
		expect(validation.properties.score).toMatchObject({ minimum: 0, maximum: 10 });

		expect(Object.keys(arrayItemsSchema.properties)).toEqual([
			"projectName",
			"description",
			"priority",
			"tags",
			"teamMembers",
			"addresses",
			"milestones",
			"isPublic",
		]);
		expect(arrayItemsSchema.properties.tags).toMatchObject({ uniqueItems: true, maxItems: 2 });
		expect(arrayItemsSchema.properties.tags.items["x-formbar"].options[1]).toEqual({
			value: "backend",
			title: "Back end",
			disabled: true,
		});
		expect(Object.keys(arrayItemsSchema.properties.addresses.items.properties)).toEqual([
			"label",
			"street",
			"city",
			"state",
			"postalCode",
			"country",
			"isPrimary",
		]);

		expect(Object.keys(searchFiltersSchema.properties)).toEqual([
			"query",
			"category",
			"dateRange",
			"sortBy",
			"fileSize",
			"includeArchived",
			"exactMatch",
		]);
		expect(searchFiltersSchema.properties.sortBy.enum).toEqual([
			"Relevance",
			"Date (Newest)",
			"Date (Oldest)",
			"Name (A-Z)",
			"Name (Z-A)",
			"Size",
		]);
		expect(
			searchFiltersDefinition.root.children.filter((node) => node.type === "section").map((node) => node.title),
		).toEqual(["Search Query", "Filters", "Options"]);

		expect(Object.keys(orderEntrySchema.properties)).toEqual([
			"orderNumber",
			"customerName",
			"customerEmail",
			"orderDate",
			"deliveryDate",
			"paymentMethod",
			"currency",
			"lineItems",
			"taxRate",
			"discount",
			"shippingCost",
			"notes",
			"rushOrder",
			"requiresSignature",
		]);
		expect(orderEntrySchema.properties.lineItems).toMatchObject({ minItems: 1, maxItems: 20 });
		expect(orderEntrySchema.properties.lineItems.items.required).toEqual(["description", "amount"]);
		expect(orderEntrySchema.properties.orderDate.format).toBe("date");
		expect(orderEntrySchema.properties.deliveryDate.format).toBe("date");

		expect(arbiterCalculatedData).toEqual({ quantity: 1, unitPrice: 25 });
		expect(arbiterCalculatedUiState).toEqual({ tier: "small", showBulkDiscount: false });
		expect(arbiterValidationData).toEqual({ name: "", email: "", age: 0, agreeToTerms: false });
		expect(arbiterValidationSchema.required).toEqual(["name", "email", "age", "agreeToTerms"]);
		expect(arbiterValidationSchema.properties).toMatchObject({
			name: { minLength: 1 },
			email: { format: "email" },
			age: { type: "number", minimum: 18 },
			agreeToTerms: { const: true },
		});
	});

	it("owns actions, repeaters, outputs, and conditions only in serializable definitions", () => {
		expect(
			nodes(definition("rich-validation").root)
				.filter((node) => node.type === "action")
				.map((node) => node.action),
		).toEqual(["validate", "submit", "reset"]);
		expect(nodes(definition("array-items").root).filter((node) => node.type === "repeater")).toHaveLength(4);
		expect(
			nodes(definition("order-entry").root)
				.filter((node) => node.type === "output")
				.map((node) => node.label),
		).toEqual(["Subtotal", "Tax Amount", "Discount Amount", "Total"]);
		const calculated = nodes(definition("arbiter-calculated").root);
		expect(calculated.filter((node) => node.type === "output").map((node) => node.label)).toEqual([
			"Tier",
			"Subtotal",
			"Bulk Discount (10%)",
			"Total",
			"Total",
		]);
		expect(calculated.filter((node) => node.type === "conditional")).toHaveLength(1);
	});

	it("server-renders all six through the shared host without direct host controls", () => {
		for (const id of ids) {
			const demo = fixture(id);
			const source = demo.sources[0];
			const prepared = createSchemaForm<Record<string, unknown>, Record<string, unknown>>(source.schema, {
				provider,
				side: "input",
				definition: source.definition,
			});
			const form = createForm<Record<string, unknown>, Record<string, unknown>>({
				initialData: source.initialData,
				initialUiState: source.initialUiState ?? {},
			});
			const html = renderToString(
				createElement(FormRenderer<Record<string, unknown>, Record<string, unknown>>, {
					...prepared,
					form,
					actions: demo.runtimeProfile?.actions,
				}),
			);
			expect(html, id).toContain("data-formbar-definition");
			expect(html, id).not.toContain("schema-demo-actions");
			form.dispose();
		}
	});
});
