// @vitest-environment jsdom
import type { FormNode } from "@formbar/declarative";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { arrayItemsDemo } from "../demos/08-array-items";
import { orderEntryDemo } from "../demos/14-order-entry";
import type { SchemaDemoFixture } from "../demos/baseline-contracts";
import { literal } from "../demos/kalada-fixture-programs";
import { installDemo } from "../runtime/kalada-demo-install";
import { button, cleanupDemos, click, labelled, mountDemo, setInput, setSelect } from "./extension-demo-test-utils";
import { formSubmit, required } from "./kalada-demo-c-test-utils";

afterEach(cleanupDemos);

type View = Awaited<ReturnType<typeof mountDemo>>;
function rows(view: View, id: string): HTMLLIElement[] {
	return [...view.container.querySelectorAll<HTMLLIElement>(`[data-formbar-node="${id}"] > ol > li`)];
}
function rowValues(view: View): string[] {
	return rows(view, "line-items").map((row) => row.querySelector<HTMLInputElement>("input")?.value ?? "");
}
function destination(view: View, id: string, token: string, parent: ParentNode = view.container): void {
	const select = parent.querySelector<HTMLSelectElement>(`[data-kalada-action="${id}"] select`);
	if (!select) throw new Error(`Missing destination for ${id}`);
	act(() => {
		select.value = token;
		select.dispatchEvent(new Event("change", { bubbles: true }));
	});
}

function extendedOrderFixture(): SchemaDemoFixture {
	const source = orderEntryDemo.sources[0];
	const definition = source.definition;
	const target = { namespace: "data" as const, segments: ["lineItems"] };
	const swap: FormNode = {
		type: "action",
		id: "swap-line",
		label: "Swap Line Items",
		action: "array.swap",
		target,
		payload: literal({}),
	};
	const insert: FormNode = {
		type: "action",
		id: "insert-line",
		label: "Insert Line Item",
		action: "array.insert",
		target,
		payload: literal({ description: "Inserted", amount: 3 }),
	};
	const children: FormNode[] = definition.root.children.map((node) =>
		node.type === "section" && node.id === "payment"
			? {
					...node,
					children: node.children.map((child) =>
						child.type === "repeater" ? { ...child, children: [...child.children, swap] } : child,
					),
				}
			: node,
	);
	return {
		...orderEntryDemo,
		sources: [
			{
				...source,
				definition: { ...definition, root: { ...definition.root, children: [...children, insert] } },
				initialData: {
					lineItems: [
						{ description: "First", amount: 1 },
						{ description: "Second", amount: 2 },
					],
				},
			},
		],
	};
}

describe("app-installed Kalada row actions", () => {
	it("appends, moves and removes native rows by stable identity with minItems and outgoing order", async () => {
		const submitted = vi.fn();
		const view = await mountDemo(orderEntryDemo, submitted);
		expect(view.container.querySelector("form[data-kalada-v1]"), view.container.textContent).not.toBeNull();
		await click(button(view, "Add Line Item"));
		expect(rows(view, "line-items")).toHaveLength(1);
		const first = rows(view, "line-items")[0].dataset.kaladaRowKey;
		setInput(labelled(view, "Description") as HTMLInputElement, "First");
		await click(button(view, "Add Line Item"));
		const second = rows(view, "line-items")[1].dataset.kaladaRowKey;
		expect(second).not.toBe(first);
		setInput(
			required(rows(view, "line-items")[1].querySelector<HTMLInputElement>('input[type="text"]'), "second description"),
			"Second",
		);
		if (!first) throw new Error("Missing first row identity");
		destination(view, "line-up", first, rows(view, "line-items")[1]);
		await click(
			required(
				rows(view, "line-items")[1].querySelector<HTMLButtonElement>('[data-kalada-action="line-up"] button'),
				"move action",
			),
		);
		expect(rows(view, "line-items").map((row) => row.dataset.kaladaRowKey)).toEqual([second, first]);
		expect(rowValues(view)).toEqual(["Second", "First"]);
		await click(
			required(
				rows(view, "line-items")[1].querySelector<HTMLButtonElement>('[data-kalada-action="line-remove"] button'),
				"remove action",
			),
		);
		expect(rows(view, "line-items").map((row) => row.dataset.kaladaRowKey)).toEqual([second]);
		await click(
			required(
				rows(view, "line-items")[0].querySelector<HTMLButtonElement>('[data-kalada-action="line-remove"] button'),
				"minimum remove action",
			),
		);
		expect(rows(view, "line-items")).toHaveLength(1);
		setInput(labelled(view, "Customer Name") as HTMLInputElement, "Customer");
		setInput(labelled(view, "Order Date") as HTMLInputElement, "2026-09-23");
		setInput(labelled(view, "Amount") as HTMLInputElement, "50");
		const payment = labelled(view, "Payment Method") as HTMLSelectElement;
		setSelect(payment, [...payment.options].find((option) => option.textContent === "Credit Card")?.value ?? "");
		await click(formSubmit(view));
		expect(submitted.mock.calls[0]?.[0]).toMatchObject({ lineItems: [{ description: "Second", amount: 50 }] });
	});

	it("installs custom row widgets or fails explicitly rather than silently dropping writable repeaters", async () => {
		const view = await mountDemo(arrayItemsDemo);
		expect(view.container.querySelector("form[data-kalada-v1]"), view.container.textContent).not.toBeNull();
		await click(button(view, "Add Tags"));
		expect(rows(view, "tags")).toHaveLength(1);
		expect(rows(view, "tags")[0].querySelector("select")).not.toBeNull();
	});

	it("cannot replay an old array action after its revision changes", async () => {
		const source = orderEntryDemo.sources[0];
		const host = installDemo({
			version: 2,
			schema: source.schema,
			definition: source.definition,
			initialData: source.initialData,
		});
		try {
			const action = (id: string) => {
				const node = host
					.snapshot()
					.tree.children?.flatMap((child) => child.children ?? [])
					.find((child) => child.nodeId === id);
				if (!node?.action) throw new Error(`Missing ${id} action`);
				return node.action.invoke;
			};
			const append = action("line-add");
			expect((await append()).status).toBe("applied");
			const data = host.snapshot().data;
			expect((await append()).status).toBe("stale");
			expect(host.snapshot().data).toEqual(data);
		} finally {
			host.dispose();
		}
	});

	it("denies maxItems overflow, inserts and swaps using live destination row keys", async () => {
		const view = await mountDemo(extendedOrderFixture());
		expect(view.container.querySelector("form[data-kalada-v1]"), view.container.textContent).not.toBeNull();
		const first = rows(view, "line-items")[0].dataset.kaladaRowKey;
		const second = rows(view, "line-items")[1].dataset.kaladaRowKey;
		expect(first).not.toBe(second);
		for (let index = 2; index < 20; index++) await click(button(view, "Add Line Item"));
		expect(rows(view, "line-items")).toHaveLength(20);
		await click(button(view, "Add Line Item"));
		expect(rows(view, "line-items")).toHaveLength(20);
		await click(
			required(
				rows(view, "line-items")[19].querySelector<HTMLButtonElement>('[data-kalada-action="line-remove"] button'),
				"remove",
			),
		);
		expect(rows(view, "line-items")).toHaveLength(19);
		destination(view, "insert-line", first ?? "");
		await click(button(view, "Insert Line Item"));
		expect(rows(view, "line-items")[0].querySelector<HTMLInputElement>("input")?.value).toBe("Inserted");
		expect(rows(view, "line-items")[1].dataset.kaladaRowKey).toBe(first);
		destination(view, "swap-line", second ?? "", rows(view, "line-items")[0]);
		await click(
			required(
				rows(view, "line-items")[0].querySelector<HTMLButtonElement>('[data-kalada-action="swap-line"] button'),
				"swap",
			),
		);
		expect(rows(view, "line-items")[0].dataset.kaladaRowKey).toBe(second);
	});
});
