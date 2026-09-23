// @vitest-environment jsdom
import type { ActionHandler, FormDefinition } from "@formbar/declarative";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FormRenderer } from "../index.js";
import { mountForm } from "./renderer-test-utils.js";

const schema = { type: "object", properties: { name: { type: "string" } } };
const mounted: Array<ReturnType<typeof mountForm<Record<string, unknown>>>> = [];

afterEach(() => {
	for (const item of mounted.splice(0)) item.unmount();
});

function mount(definition: FormDefinition, handler?: ActionHandler, strict = false) {
	const view = mountForm({
		schema,
		definition,
		data: { name: "Ada" },
		strict,
		...(handler ? { actions: [{ id: "host.save", handler }] } : {}),
	});
	mounted.push(view);
	return view;
}

function action(action: string, extra = {}): FormDefinition {
	return { version: 1, id: "action-form", root: { type: "action", id: "action", action, label: "Run", ...extra } };
}

describe("action rendering", () => {
	it("renders only placed native action buttons with stable accessible status relationships", async () => {
		const handler = vi.fn();
		const view = mount(action("host.save"), handler);
		const button = view.container.querySelector("button");
		expect(view.container.querySelectorAll("button")).toHaveLength(1);
		expect(button?.type).toBe("button");
		expect(button?.textContent).toBe("Run");
		const statusId = button?.getAttribute("aria-describedby") ?? "";
		const status = document.getElementById(statusId);
		expect(status?.tagName).toBe("OUTPUT");
		expect(status?.getAttribute("data-formbar-action")).toBe("host.save");
		await act(async () => button?.click());
		expect(handler).toHaveBeenCalledOnce();
		expect(status?.textContent).toBe("Action completed.");
	});

	it("disables unknown actions with a deterministic non-sensitive diagnostic", () => {
		const view = mount(action("private.missing"));
		const button = view.container.querySelector("button");
		const status = view.container.querySelector('[data-formbar-diagnostic="unknown-action"]');
		expect(button?.disabled).toBe(true);
		expect(status?.textContent).toBe("Action unavailable.");
		expect(view.container.textContent).not.toContain("private.missing");
	});

	it("keeps failed handlers enabled for a successful retry", async () => {
		const handler = vi.fn().mockRejectedValueOnce(new Error("private failure")).mockResolvedValueOnce(undefined);
		const view = mount(action("host.save"), handler);
		const button = view.container.querySelector("button") as HTMLButtonElement;
		const status = view.container.querySelector('output[data-formbar-action="host.save"]');

		await act(async () => button.click());
		expect(button.disabled).toBe(false);
		expect(status?.textContent).toBe("Action failed.");
		expect(status?.getAttribute("data-formbar-diagnostic")).toBe("action-failed");
		await act(async () => button.click());
		expect(status?.textContent).toBe("Action completed.");
		expect(status?.hasAttribute("data-formbar-diagnostic")).toBe(false);
		expect(handler).toHaveBeenCalledTimes(2);
	});

	it("reacts to pending drop state and never duplicates submit lifecycle announcements", async () => {
		let resolve!: () => void;
		const pending = new Promise<void>((done) => {
			resolve = done;
		});
		const view = mount(action("host.save"), () => pending);
		const button = view.container.querySelector("button") as HTMLButtonElement;
		act(() => button.click());
		await act(async () => Promise.resolve());
		expect(button.disabled).toBe(true);
		expect(button.getAttribute("aria-busy")).toBe("true");
		expect(view.container.querySelector('output[data-formbar-action="host.save"]')?.textContent).toBe(
			"Action in progress.",
		);
		await act(async () => resolve());

		const submitView = mount(action("submit"));
		const submitButton = submitView.container.querySelector("button") as HTMLButtonElement;
		expect(submitButton.getAttribute("aria-describedby")).toBeNull();
		expect(submitView.container.querySelectorAll('[data-formbar-status=""]')).toHaveLength(1);
		await act(async () => submitButton.click());
		expect(submitView.container.querySelectorAll("output")).toHaveLength(0);
	});

	it("reactively disables a pending replace action during a repeated submission", async () => {
		let resolveAction!: () => void;
		const pendingAction = new Promise<void>((done) => {
			resolveAction = done;
		});
		let resolveSubmit!: () => void;
		const pendingSubmit = new Promise<void>((done) => {
			resolveSubmit = done;
		});
		let submissions = 0;
		const definition: FormDefinition = {
			version: 1,
			id: "submission-lock",
			root: {
				type: "group",
				id: "actions",
				children: [
					{ type: "action", id: "submit", action: "submit" },
					{ type: "action", id: "save", action: "host.save", concurrency: "replace" },
				],
			},
		};
		const view = mountForm({
			schema,
			definition,
			data: { name: "Ada" },
			formOptions: {
				onSubmit: async () => {
					if (++submissions === 1) return { ok: true, submitId: "first" };
					await pendingSubmit;
					return { ok: true, submitId: "second" };
				},
			},
			actions: [{ id: "host.save", handler: () => pendingAction }],
		});
		mounted.push(view);
		const submitButton = view.container.querySelector('[data-formbar-action="submit"] button') as HTMLButtonElement;
		const saveButton = view.container.querySelector('[data-formbar-action="host.save"] button') as HTMLButtonElement;

		await act(async () => view.form.submit());
		act(() => saveButton.click());
		await act(async () => Promise.resolve());
		expect(saveButton.disabled).toBe(false);
		expect(saveButton.getAttribute("aria-busy")).toBe("true");
		let submission!: ReturnType<typeof view.form.submit>;
		act(() => {
			submission = view.form.submit();
		});
		await act(async () => Promise.resolve());
		expect(submitButton.disabled).toBe(true);
		expect(submitButton.getAttribute("aria-busy")).toBeNull();
		expect(saveButton.disabled).toBe(true);
		expect(saveButton.getAttribute("aria-busy")).toBe("true");
		expect(view.container.querySelectorAll('output[data-formbar-action="submit"]')).toHaveLength(0);
		expect(view.container.querySelectorAll('[data-formbar-status=""]')).toHaveLength(1);

		resolveSubmit();
		await act(async () => submission);
		expect(saveButton.disabled).toBe(false);
		expect(saveButton.getAttribute("aria-busy")).toBe("true");
		await act(async () => resolveAction());
	});

	it("keeps reset accessible while it aborts submission and restores the baseline", async () => {
		let started!: (signal: AbortSignal) => void;
		const submissionStarted = new Promise<AbortSignal>((resolve) => {
			started = resolve;
		});
		const pending = new Promise<void>(() => undefined);
		const definition: FormDefinition = {
			version: 1,
			id: "submission-reset",
			root: {
				type: "group",
				id: "actions",
				children: [
					{ type: "action", id: "submit", action: "submit" },
					{ type: "action", id: "reset", action: "reset" },
				],
			},
		};
		const view = mountForm({
			schema,
			definition,
			data: { name: "Ada" },
			formOptions: {
				onSubmit: async ({ signal }) => {
					started(signal);
					await pending;
					return { ok: true, submitId: "late" };
				},
			},
		});
		mounted.push(view);
		const submitButton = view.container.querySelector('[data-formbar-action="submit"] button') as HTMLButtonElement;
		const resetButton = view.container.querySelector('[data-formbar-action="reset"] button') as HTMLButtonElement;
		act(() => view.form.setValue("name", "edited"));
		act(() => submitButton.click());
		let signal!: AbortSignal;
		await act(async () => {
			signal = await submissionStarted;
		});

		expect(submitButton.disabled).toBe(true);
		expect(resetButton.disabled).toBe(false);
		const statusId = resetButton.getAttribute("aria-describedby") ?? "";
		expect(document.getElementById(statusId)?.tagName).toBe("OUTPUT");
		await act(async () => resetButton.click());
		expect(signal.aborted).toBe(true);
		expect(view.form.getState().data).toEqual({ name: "Ada" });
		expect(view.form.isSubmitting()).toBe(false);
		expect(resetButton.disabled).toBe(false);
		expect(document.getElementById(statusId)?.textContent).toBe("Action completed.");
		expect(view.container.querySelectorAll('output[data-formbar-action="submit"]')).toHaveLength(0);
	});

	it("is StrictMode-safe across unmount with ignored pending work", async () => {
		const pending = new Promise<void>(() => undefined);
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const view = mount(action("host.save", { concurrency: "replace" }), () => pending, true);
		act(() => view.container.querySelector("button")?.click());
		await act(async () => Promise.resolve());
		view.unmount();
		mounted.splice(mounted.indexOf(view), 1);
		await act(async () => Promise.resolve());
		expect(error).not.toHaveBeenCalled();
		error.mockRestore();
	});

	it("aborts the old registry lease before replacement handlers take authority", async () => {
		let oldSignal: AbortSignal | undefined;
		const replacement = vi.fn();
		const view = mount(action("host.save", { concurrency: "replace" }), (_request, context) => {
			oldSignal = context.signal;
			return new Promise<void>(() => undefined);
		});
		act(() => view.container.querySelector("button")?.click());
		await act(async () => Promise.resolve());
		act(() =>
			view.root.render(
				<FormRenderer {...view.prepared} form={view.form} actions={[{ id: "host.save", handler: replacement }]} />,
			),
		);
		await act(async () => Promise.resolve());
		expect(oldSignal?.aborted).toBe(true);
		await act(async () => view.container.querySelector("button")?.click());
		expect(replacement).toHaveBeenCalledOnce();
	});
});
