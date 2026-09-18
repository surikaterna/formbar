import { type SubmitResult, createForm } from "@formbar/core";
import type { LayoutNode, SchemaFormResult } from "@formbar/from-schema";
import { render } from "ink-testing-library";
import React, { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { FormbarTui, NO_COLOR_TUI_THEME } from "../index.js";
import { FakeInteractionHost, FakeTextInputSource } from "./fake-interaction-host.js";

const layout: LayoutNode = {
	type: "section",
	id: "root",
	children: [
		{
			type: "group",
			id: "account",
			children: [
				{ type: "field", id: "password", path: "password" },
				{ type: "field", id: "name", path: "name" },
			],
		},
	],
};

const schema: SchemaFormResult = {
	fields: [
		{ path: "password", type: "string", required: true, metadata: { title: "Password", widget: "password" } },
		{ path: "name", type: "string", required: true, metadata: { title: "Name" } },
	],
	layout,
	metadata: {},
	validators: [],
	defaults: {},
	optionsByPath: new Map(),
	warnings: [],
};

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((onResolve, onReject) => {
		resolve = onResolve;
		reject = onReject;
	});
	return { promise, resolve, reject };
}

function element(
	form: ReturnType<typeof createForm<Record<string, unknown>, unknown>>,
	capability: FakeInteractionHost,
	textInput: FakeTextInputSource,
	props: Record<string, unknown> = {},
) {
	return React.createElement(FormbarTui, {
		form,
		capability,
		textInput,
		schema,
		layout,
		viewportWidth: 80,
		theme: NO_COLOR_TUI_THEME,
		...props,
	});
}

describe("FormbarTui submission", () => {
	it("uses form-submit without changing Enter and suppresses a duplicate renderer attempt", async () => {
		const result = deferred<SubmitResult>();
		const onSubmit = vi.fn(() => result.promise);
		const form = createForm<Record<string, unknown>, unknown>({
			initialData: { password: "secret", name: "Ada" },
			onSubmit,
		});
		const host = new FakeInteractionHost();
		const view = render(element(form, host, new FakeTextInputSource()));
		await vi.waitFor(() => expect(view.lastFrame()).toContain("Ctrl+S: Submit form"));
		expect(host.dispatch("enter")).toBe(true);
		expect(form.isSubmitting()).toBe(false);
		expect(host.dispatch("form-submit")).toBe(true);
		expect(host.dispatch("form-submit")).toBe(true);
		expect(onSubmit).toHaveBeenCalledTimes(1);
		await vi.waitFor(() => expect(view.lastFrame()).toContain("Submission: pending"));
		result.resolve({ ok: true, submitId: "one" });
		await vi.waitFor(() => expect(view.lastFrame()).toContain("Submission: succeeded"));
		view.unmount();
		form.dispose();
	});

	it("delivers the core result and post-settlement state to the current callback", async () => {
		const result = deferred<SubmitResult>();
		const form = createForm<Record<string, unknown>, unknown>({
			initialData: { password: "secret", name: "Ada" },
			onSubmit: () => result.promise,
		});
		const host = new FakeInteractionHost();
		const source = new FakeTextInputSource();
		const oldCallback = vi.fn();
		const currentCallback = vi.fn();
		const view = render(element(form, host, source, { onSubmitSuccess: oldCallback }));
		await vi.waitFor(() => expect(host.dispatch("form-submit")).toBe(true));
		view.rerender(element(form, host, source, { onSubmitSuccess: currentCallback }));
		const settled = { ok: true, submitId: "current" } as const;
		result.resolve(settled);
		await vi.waitFor(() => expect(currentCallback).toHaveBeenCalledTimes(1));
		expect(oldCallback).not.toHaveBeenCalled();
		expect(currentCallback.mock.calls[0]?.[0]).toEqual({ result: settled, state: form.getState() });
		view.unmount();
		form.dispose();
	});

	it("renders authoritative issues without masked values, details, or controls and focuses the first error", async () => {
		const form = createForm<Record<string, unknown>, unknown>({
			initialData: { password: "TOP-SECRET", name: "Ada" },
			onSubmit: async () => ({
				ok: false,
				submitId: "failure",
				fieldIssues: [
					{
						code: "password-server",
						message: "TOP-SECRET\u001b[31m",
						severity: "error",
						path: { namespace: "data", segments: ["password", "nested"] },
						source: { origin: "submit", validatorId: "server" },
						details: { token: "DETAIL-SECRET" },
					},
				],
			}),
		});
		const host = new FakeInteractionHost();
		const view = render(element(form, host, new FakeTextInputSource()));
		await vi.waitFor(() => expect(host.dispatch("form-submit")).toBe(true));
		await vi.waitFor(() => expect(view.lastFrame()).toContain("ERROR Password: Invalid value"));
		const frames = view.frames.join("\n");
		expect(frames).not.toContain("TOP-SECRET");
		expect(frames).not.toContain("DETAIL-SECRET");
		expect(view.lastFrame()).toContain("Password *:");
		view.unmount();
		form.dispose();
	});

	it("invalidates callback and status effects when reset or unmount occurs while pending", async () => {
		const first = deferred<SubmitResult>();
		const onSuccess = vi.fn();
		const form = createForm<Record<string, unknown>, unknown>({
			initialData: { password: "secret", name: "Ada" },
			onSubmit: () => first.promise,
		});
		const host = new FakeInteractionHost();
		const view = render(
			React.createElement(
				StrictMode,
				null,
				element(form, host, new FakeTextInputSource(), { onSubmitSuccess: onSuccess }),
			),
		);
		await vi.waitFor(() => expect(host.dispatch("form-submit")).toBe(true));
		form.reset();
		expect(host.dispatch("form-submit")).toBe(true);
		first.resolve({ ok: true, submitId: "late" });
		await Promise.resolve();
		await Promise.resolve();
		expect(onSuccess).not.toHaveBeenCalled();
		expect(view.lastFrame()).not.toContain("Submission: succeeded");
		view.unmount();
		form.dispose();
	});

	it("contains callback failures as fixed diagnostics without changing success", async () => {
		const diagnostics: unknown[] = [];
		const form = createForm<Record<string, unknown>, unknown>({
			initialData: { password: "secret", name: "Ada" },
			onSubmit: async () => ({ ok: true, submitId: "success" }),
		});
		const host = new FakeInteractionHost();
		const view = render(
			element(form, host, new FakeTextInputSource(), {
				onSubmitSuccess: () => {
					throw new Error("PRIVATE CALLBACK VALUE");
				},
				onDiagnostic: (diagnostic: unknown) => diagnostics.push(diagnostic),
			}),
		);
		await vi.waitFor(() => expect(host.dispatch("form-submit")).toBe(true));
		await vi.waitFor(() => expect(view.lastFrame()).toContain("Submit callback failed"));
		expect(view.lastFrame()).toContain("Submission: succeeded");
		expect(JSON.stringify([view.frames, diagnostics])).not.toContain("PRIVATE CALLBACK VALUE");
		expect(diagnostics).toEqual([
			{ code: "submit-callback-error", severity: "error", message: "Submit callback failed" },
		]);
		view.unmount();
		form.dispose();
	});

	it("uses authoritative validation order to focus an accessible error and blur only the prior field", async () => {
		const onFailure = vi.fn();
		const form = createForm<Record<string, unknown>, unknown>({
			initialData: { password: "secret", name: "Ada" },
			validators: [() => [issue("required", "Password is required", "error", ["password"])]],
		});
		const host = new FakeInteractionHost();
		const view = render(element(form, host, new FakeTextInputSource(), { onSubmitFailure: onFailure }));
		await vi.waitFor(() => expect(host.dispatch("enter")).toBe(true));
		expect(host.dispatch("arrow-down")).toBe(true);
		form.reset();
		expect(form.fieldDynamic("name").isTouched()).toBe(false);
		expect(host.dispatch("form-submit")).toBe(true);
		await vi.waitFor(() => expect(view.lastFrame()).toContain("ERROR Password: Invalid value"));
		expect(form.fieldDynamic("name").isTouched()).toBe(true);
		expect(form.fieldDynamic("password").isTouched()).toBe(false);
		expect(view.lastFrame()).toContain("> Password *:");
		expect(onFailure).toHaveBeenCalledTimes(1);
		view.unmount();
		form.dispose();
	});

	it("renders form and unavailable issues deterministically without focusing warning or info", async () => {
		const form = createForm<Record<string, unknown>, unknown>({
			initialData: { password: "secret", name: "Ada" },
			validators: [
				() => [
					issue("global", "Global warning", "warning", []),
					issue("missing", "Missing information", "info", ["notRendered"]),
				],
			],
		});
		const host = new FakeInteractionHost();
		const view = render(element(form, host, new FakeTextInputSource()));
		await vi.waitFor(() => expect(host.dispatch("form-submit")).toBe(true));
		await vi.waitFor(() => expect(view.lastFrame()).toContain("Submission: succeeded"));
		const frame = view.lastFrame() ?? "";
		expect(frame.indexOf("WARNING Form: Global warning")).toBeLessThan(
			frame.indexOf("INFO Unavailable field: Missing information"),
		);
		expect(frame).toContain("> account");
		view.unmount();
		form.dispose();
	});

	it("tracks external submission without duplicating it, then clears settled status on reset", async () => {
		const pending = deferred<SubmitResult>();
		const onSubmit = vi.fn(() => pending.promise);
		const onSuccess = vi.fn();
		const form = createForm<Record<string, unknown>, unknown>({
			initialData: { password: "secret", name: "Ada" },
			onSubmit,
		});
		const host = new FakeInteractionHost();
		const view = render(element(form, host, new FakeTextInputSource(), { onSubmitSuccess: onSuccess }));
		const external = form.submit();
		await vi.waitFor(() => expect(view.lastFrame()).toContain("Submission: pending"));
		expect(host.dispatch("form-submit")).toBe(true);
		expect(onSubmit).toHaveBeenCalledTimes(1);
		pending.resolve({ ok: true, submitId: "external" });
		await external;
		await vi.waitFor(() => expect(view.lastFrame()).toContain("Submission: succeeded"));
		expect(onSuccess).not.toHaveBeenCalled();
		form.reset();
		await vi.waitFor(() => expect(view.lastFrame()).not.toContain("Submission:"));
		view.unmount();
		form.dispose();
	});

	it("retries after a settled renderer failure", async () => {
		const onSubmit = vi
			.fn<() => Promise<SubmitResult>>()
			.mockResolvedValueOnce({ ok: false, submitId: "first" })
			.mockResolvedValueOnce({ ok: true, submitId: "second" });
		const form = createForm<Record<string, unknown>, unknown>({
			initialData: { password: "secret", name: "Ada" },
			onSubmit,
		});
		const host = new FakeInteractionHost();
		const view = render(element(form, host, new FakeTextInputSource()));
		await vi.waitFor(() => expect(host.dispatch("form-submit")).toBe(true));
		await vi.waitFor(() => expect(view.lastFrame()).toContain("Submission: failed"));
		expect(host.dispatch("form-submit")).toBe(true);
		await vi.waitFor(() => expect(view.lastFrame()).toContain("Submission: succeeded"));
		expect(onSubmit).toHaveBeenCalledTimes(2);
		view.unmount();
		form.dispose();
	});
});

function issue(code: string, message: string, severity: "error" | "warning" | "info", segments: readonly string[]) {
	return {
		code,
		message,
		severity,
		path: { namespace: "data" as const, segments },
		source: { origin: "function-validator" as const, validatorId: "fixture" },
	};
}
