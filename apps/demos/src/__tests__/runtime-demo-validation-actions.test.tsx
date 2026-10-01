// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { basicContactDemo } from "../demos/01-basic-contact";
import { richValidationDemo } from "../demos/06-rich-validation";
import { arbiterValidationDemo } from "../demos/20-arbiter-validation-gating";
import { installDemo } from "../runtime/kalada-demo-install";
import { button, cleanupDemos, click, labelled, mountDemo, resultJson, setInput } from "./extension-demo-test-utils";
import { formSubmit } from "./kalada-demo-c-test-utils";

afterEach(cleanupDemos);

describe("app-installed Kalada validation and lifecycle", () => {
	it("blocks invalid submit, shows issues, clears them on edit and resets initialized data", async () => {
		const submitted = vi.fn();
		const view = await mountDemo(basicContactDemo, submitted, true);
		expect(view.container.querySelector("form[data-kalada-v1]"), view.container.textContent).not.toBeNull();
		await click(formSubmit(view));
		expect(submitted).not.toHaveBeenCalled();
		expect(view.container.querySelector("[data-kalada-issue-summary]")?.textContent).toContain("email");
		setInput(labelled(view, "Full Name") as HTMLInputElement, "Ada");
		setInput(labelled(view, "Email") as HTMLInputElement, "ada@example.com");
		expect(view.container.querySelector("[data-kalada-issue-summary]")).toBeNull();
		await click(formSubmit(view));
		expect(submitted).toHaveBeenCalledWith({ name: "Ada", email: "ada@example.com" });
		const successful = resultJson(view);
		setInput(labelled(view, "Email") as HTMLInputElement, "invalid");
		await click(formSubmit(view));
		expect(submitted).toHaveBeenCalledOnce();
		expect(resultJson(view)).toBe(successful);
		await click(button(view, "Reset"));
		expect((labelled(view, "Email") as HTMLInputElement).value).toBe("");
		expect(view.container.querySelector("[data-kalada-issue-summary]")).toBeNull();
	});

	it("provides explicit validation action feedback and blocks invalid rich-schema submit", async () => {
		const submitted = vi.fn();
		const view = await mountDemo(richValidationDemo, submitted);
		expect(view.container.querySelector("form[data-kalada-v1]"), view.container.textContent).not.toBeNull();
		setInput(labelled(view, "Username") as HTMLInputElement, "x!");
		await click(button(view, "Validate"));
		expect(view.container.querySelector("[data-kalada-issue-summary]")?.textContent).toContain('keyword "pattern"');
		await click(formSubmit(view));
		expect(submitted).not.toHaveBeenCalled();
	});

	it("keeps a denied presentation action from bypassing schema validation", async () => {
		const submitted = vi.fn();
		const view = await mountDemo(arbiterValidationDemo, submitted);
		expect(view.container.querySelector("form[data-kalada-v1]"), view.container.textContent).not.toBeNull();
		const action = button(view, "Submit");
		expect(action.disabled).toBe(true);
		await click(action);
		expect(submitted).not.toHaveBeenCalled();
		await click(formSubmit(view));
		expect(submitted).not.toHaveBeenCalled();
		expect(view.container.querySelector("[data-kalada-issue-summary]")).not.toBeNull();
	});

	it("rejects stale direct-write callbacks after edits and reset without mutating submission", async () => {
		const submitted = vi.fn();
		const source = basicContactDemo.sources[0];
		const host = installDemo(
			{ version: 2, schema: source.schema, definition: source.definition ?? null, initialData: {} },
			submitted,
		);
		try {
			const email = host.snapshot().controls.find((control) => control.rendererId === "email")?.writers.value;
			if (!email) throw new Error("Missing direct email writer");
			expect(email("ada@example.com")).toEqual({ status: "applied" });
			expect(email("stale@example.com").status).toBe("stale");
			expect(host.snapshot().data).toMatchObject({ email: "ada@example.com" });
			const old = host.snapshot().controls.find((control) => control.rendererId === "email")?.writers.value;
			expect(host.reset().ok).toBe(true);
			expect(old?.("stale-after-reset@example.com").status).toBe("stale");
			expect(host.snapshot().data).toEqual({});
		} finally {
			host.dispose();
		}
		expect(submitted).not.toHaveBeenCalled();
	});

	it("fences a pending async submit when the live draft changes before validation settles", async () => {
		const submitted = vi.fn();
		const source = basicContactDemo.sources[0];
		const host = installDemo(
			{ version: 2, schema: source.schema, definition: source.definition ?? null, initialData: {} },
			submitted,
		);
		try {
			const write = (widget: string, value: string) => {
				const writer = host.snapshot().controls.find((control) => control.rendererId === widget)?.writers.value;
				if (!writer) throw new Error(`Missing ${widget} writer`);
				expect(writer(value).status).toBe("applied");
			};
			write("text", "Ada");
			write("email", "ada@example.com");
			const pending = host.submit();
			write("email", "invalid");
			expect((await pending).status).not.toBe("submitted");
			expect(submitted).not.toHaveBeenCalled();
			expect(host.snapshot().data).toMatchObject({ email: "invalid" });
		} finally {
			host.dispose();
		}
	});
});
