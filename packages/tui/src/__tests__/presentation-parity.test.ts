import { type ValidationIssue, createForm } from "@formbar/core";
import { type LayoutNode, type SchemaFormResult, createFormPresentation } from "@formbar/from-schema";
import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { FormbarTui, type TargetRegistration } from "../index.js";
import { FakeInteractionHost, FakeTextInputSource } from "./fake-interaction-host.js";

const layout: LayoutNode = {
	type: "section",
	id: "root",
	children: [
		{
			type: "group",
			id: "profile",
			children: [
				{ type: "field", id: "name-node", path: "name" },
				{ type: "field", id: "role-node", path: "role" },
			],
		},
	],
};

const options = [{ value: "admin", title: "Administrator" }];
const schema: SchemaFormResult = {
	fields: [
		{ path: "name", type: "string", required: true, metadata: { title: "Name", readOnly: true } },
		{ path: "role", type: "string", required: false, metadata: { title: "Role" } },
	],
	layout,
	metadata: {},
	validators: [],
	defaults: {},
	optionsByPath: new Map([["role", options]]),
	warnings: [],
};

describe("TUI shared presentation semantics", () => {
	it("renders shared visible fields, metadata, options, and owned issues", async () => {
		const issue = validationIssue("role", "Choose carefully");
		const form = createForm<Record<string, unknown>, Record<string, unknown>>({
			initialData: { name: "Ada", role: "admin" },
			initialUiState: { "name.visible": 0 },
			validators: [() => [issue]],
		});
		form.fieldDynamic("role").set("admin");
		const expected = createFormPresentation(schema, {
			uiState: form.getState().uiState,
			issues: form.getState().issues,
		});
		const host = new FakeInteractionHost();
		const view = render(element(form, host));

		await vi.waitFor(() => expect(view.lastFrame()).toContain("Role: Administrator"));
		expect(expected.layout?.children?.[0]?.children?.map(({ path }) => path)).toEqual(["role"]);
		expect(expected.fieldsByPath.get("role")?.options).toEqual(options);
		expect(expected.fieldsByPath.get("role")?.issues).toEqual([issue]);
		expect(view.lastFrame()).toContain("Error: Choose carefully");
		expect(view.lastFrame()).not.toContain("Name");
		view.unmount();
		form.dispose();
	});

	it("keeps drafts mounted for ordinary updates and rebuilds cleanly for dynamic structure", async () => {
		const form = createForm<Record<string, unknown>, Record<string, unknown>>({
			initialData: { name: "Ada", role: "admin" },
			initialUiState: { "name.readOnly": false },
		});
		const base = new FakeInteractionHost();
		const text = new FakeTextInputSource();
		const retained: TargetRegistration[] = [];
		let registrations = 0;
		const capability = {
			...base,
			registerActions: base.registerActions.bind(base),
			registerTargets(targets: readonly TargetRegistration[]) {
				registrations += 1;
				retained.push(...targets);
				return base.registerTargets(targets);
			},
			contributeDefaultBindings: base.contributeDefaultBindings.bind(base),
			getEffectiveBinding: base.getEffectiveBinding.bind(base),
			getRevision: base.getRevision.bind(base),
			subscribe: base.subscribe.bind(base),
		};
		const view = render(element(form, capability, text));
		await vi.waitFor(() => expect(view.lastFrame()).toContain("Enter: Enter profile"));
		base.dispatch("enter");
		base.dispatch("enter");
		text.emit("X");
		await vi.waitFor(() => expect(view.lastFrame()).toContain("AdaX│"));
		const mountedRegistrations = registrations;
		form.fieldDynamic("name").set("external");
		await vi.waitFor(() => expect(view.lastFrame()).toContain("AdaX│"));
		expect(registrations).toBe(mountedRegistrations);

		form.reset({ data: form.getState().data, uiState: { "name.visible": false } });
		await vi.waitFor(() => expect(view.lastFrame()).not.toContain("Name *"));
		expect(view.lastFrame()).toContain("Role: Administrator");
		expect(registrations).toBeGreaterThan(mountedRegistrations);
		const staleName = retained.find(({ target }) => target.kind === "field" && target.path === "name");
		expect(staleName?.invoke("activate")).toBe(false);

		form.reset({
			data: form.getState().data,
			uiState: { "name.visible": false, "role.visible": false },
		});
		await vi.waitFor(() => expect(view.lastFrame()).toContain("No visible form fields"));
		for (const input of ["enter", "tab", "space", "form-submit"]) expect(base.dispatch(input)).toBe(false);
		expect(retained.every(({ invoke }) => invoke("activate") === false)).toBe(true);
		view.unmount();
		form.dispose();
	});

	it("uses shared static read-only precedence and dynamic override semantics", async () => {
		const form = createForm<Record<string, unknown>, Record<string, unknown>>({
			initialData: { name: "Ada", role: "admin" },
		});
		const host = new FakeInteractionHost();
		const view = render(element(form, host));
		await vi.waitFor(() => expect(view.lastFrame()).toContain("Name *: Ada"));
		host.dispatch("enter");
		expect(host.dispatch("enter")).toBe(false);

		form.reset({ data: form.getState().data, uiState: { "name.readOnly": false } });
		await vi.waitFor(() => expect(host.dispatch("enter")).toBe(true));
		expect(host.dispatch("enter")).toBe(true);
		view.unmount();
		form.dispose();
	});
});

function element(
	form: ReturnType<typeof createForm<Record<string, unknown>, Record<string, unknown>>>,
	capability: FakeInteractionHost | Parameters<typeof FormbarTui>[0]["capability"],
	textInput = new FakeTextInputSource(),
) {
	return React.createElement(FormbarTui, { form, capability, textInput, schema, layout, viewportWidth: 80 });
}

function validationIssue(path: string, message: string): ValidationIssue {
	return {
		path: { namespace: "data", segments: path.split("."), canonical: path },
		severity: "error",
		message,
		code: "TEST",
		source: { origin: "function-validator", validatorId: "presentation-parity" },
	};
}
