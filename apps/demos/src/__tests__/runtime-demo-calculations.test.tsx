// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { orderEntryDemo } from "../demos/14-order-entry";
import { arbiterCalculatedDemo } from "../demos/19-arbiter-calculated";
import {
	button,
	cleanupDemos,
	click,
	labelled,
	mountDemo,
	resultJson,
	setInput,
	setSelect,
} from "./extension-demo-test-utils";
import { formSubmit } from "./kalada-demo-c-test-utils";

afterEach(cleanupDemos);

function output(view: Awaited<ReturnType<typeof mountDemo>>, id: string): string | undefined {
	return view.container.querySelector(`[data-kalada-output="${id}"] output`)?.textContent ?? undefined;
}

describe("app-installed Kalada calculated outputs", () => {
	it("reactively projects quantity, subtotal, discount and currency without storing derived data", async () => {
		const submitted = vi.fn();
		const view = await mountDemo(arbiterCalculatedDemo, submitted, true);
		expect(view.container.querySelector("form[data-kalada-v1]"), view.container.textContent).not.toBeNull();
		expect(output(view, "subtotal-output")).toBe("$25.00");
		setInput(labelled(view, "Quantity") as HTMLInputElement, "10");
		expect(output(view, "tier")).toBe("bulk");
		expect(output(view, "subtotal-output")).toBe("$250.00");
		expect(output(view, "bulk-discount")).toBe("$25.00");
		expect(output(view, "bulk-total")).toBe("$225.00");
		await click(formSubmit(view));
		expect(submitted).toHaveBeenCalledWith({ quantity: 10, unitPrice: 25 });
		expect(resultJson(view)).not.toContain("subtotal");
	});

	it("updates sumBy after row actions, leaving outputs out of the outgoing payload", async () => {
		const submitted = vi.fn();
		const view = await mountDemo(orderEntryDemo, submitted);
		expect(view.container.querySelector("form[data-kalada-v1]"), view.container.textContent).not.toBeNull();
		expect(output(view, "subtotal-output")).toBe("0");
		await click(button(view, "Add Line Item"));
		setInput(labelled(view, "Amount") as HTMLInputElement, "100");
		expect(output(view, "subtotal-output")).toBe("100");
		setInput(labelled(view, "Tax Rate (%)") as HTMLInputElement, "10");
		expect(output(view, "tax-output")).toBe("10");
		expect(output(view, "total-output")).toBe("110");
		setInput(labelled(view, "Customer Name") as HTMLInputElement, "Customer");
		setInput(labelled(view, "Order Date") as HTMLInputElement, "2026-09-23");
		setInput(labelled(view, "Description") as HTMLInputElement, "Consulting");
		const payment = labelled(view, "Payment Method") as HTMLSelectElement;
		setSelect(payment, [...payment.options].find((option) => option.textContent === "Credit Card")?.value ?? "");
		await click(formSubmit(view));
		expect(submitted).toHaveBeenCalledOnce();
		expect(submitted.mock.calls[0]?.[0]).toMatchObject({ lineItems: [{ description: "Consulting", amount: 100 }] });
		for (const name of ["subtotal", "taxAmount", "discountAmount", "total"])
			expect(submitted.mock.calls[0]?.[0]).not.toHaveProperty(name);
	});
});
