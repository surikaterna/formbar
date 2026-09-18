import type { ValidationIssue } from "@formbar/core";
import type { LayoutNode } from "@formbar/from-schema";
import { describe, expect, it } from "vitest";
import { renderLayoutTree } from "../render-tree.js";
import { RendererRegistry } from "../renderer-registry.js";

function makeIssue(path: string, severity: "error" | "warning" = "error"): ValidationIssue {
	return {
		path: { segments: path.split(".") },
		severity,
		message: `${severity} on ${path}`,
		code: "TEST",
	} as unknown as ValidationIssue;
}

describe("renderLayoutTree a11y wiring", () => {
	it("passes aria props to field nodes with issues", () => {
		const tree: LayoutNode = {
			type: "field",
			id: "f1",
			path: "email",
		};
		const registry = new RendererRegistry();
		const issues = [makeIssue("email")];

		const element = renderLayoutTree(tree, registry, { issues });

		expect(element.props.aria).toBeDefined();
		expect(element.props.aria["aria-invalid"]).toBe(true);
		expect(element.props.aria).toMatchObject({
			id: "field-email",
			"aria-describedby": "field-email-error",
			"aria-errormessage": "field-email-error",
		});
	});

	it("passes undefined aria for non-field nodes without path", () => {
		const tree: LayoutNode = {
			type: "group",
			id: "g1",
			children: [],
		};
		const registry = new RendererRegistry();

		const element = renderLayoutTree(tree, registry);

		expect(element.props.aria).toBeUndefined();
	});

	it("sets aria-required when path is in requiredPaths", () => {
		const tree: LayoutNode = {
			type: "field",
			id: "f1",
			path: "name",
		};
		const registry = new RendererRegistry();
		const requiredPaths = new Set(["name"]);

		const element = renderLayoutTree(tree, registry, { requiredPaths });

		expect(element.props.aria["aria-required"]).toBe(true);
	});
});

describe("GroupRenderer", () => {
	it('emits role="group"', async () => {
		const { GroupRenderer } = await import("../renderers/group-renderer.js");
		const node: LayoutNode = { type: "group", id: "g1", role: "group", ariaLabel: "Test Group" };
		const el = GroupRenderer({ node, children: undefined });

		expect(el.props.role).toBe("group");
		expect(el.props["aria-label"]).toBe("Test Group");
	});
});

describe("SectionRenderer", () => {
	it('emits role="region" with aria-label', async () => {
		const { SectionRenderer } = await import("../renderers/section-renderer.js");
		const node: LayoutNode = {
			type: "section",
			id: "s1",
			props: { title: "Contact Info" },
		};
		const el = SectionRenderer({ node, children: undefined });

		expect(el.props.role).toBe("region");
		expect(el.props["aria-label"]).toBe("Contact Info");
	});
});

describe("ArrayRenderer", () => {
	it('emits role="list"', async () => {
		const { ArrayRenderer } = await import("../renderers/array-renderer.js");
		const node: LayoutNode = {
			type: "array",
			id: "a1",
			path: "items",
			props: { title: "Items" },
		};
		const el = ArrayRenderer({ node, children: undefined });

		expect(el.props.role).toBe("list");
		expect(el.props["aria-label"]).toBe("Items");
	});
});
