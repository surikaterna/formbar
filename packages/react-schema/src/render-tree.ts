import type { ValidationIssue } from "@formbar/core";
import type { LayoutNode } from "@formbar/from-schema";
import { getFieldProps } from "@formbar/react";
import type { ReactElement } from "react";
import { createElement } from "react";
import type { RendererRegistry } from "./renderer-registry.js";
import type { LayoutRendererProps } from "./renderer-types.js";
import { descriptionId, errorId, fieldId } from "./resolve-field-state.js";

/** Options for rendering a layout tree with a11y context */
export interface RenderTreeOptions {
	readonly issues?: readonly ValidationIssue[];
	readonly requiredPaths?: ReadonlySet<string>;
}

/** Render a layout tree recursively using the registry */
export function renderLayoutTree(
	tree: LayoutNode,
	registry: RendererRegistry,
	options?: RenderTreeOptions,
): ReactElement {
	const Component = registry.resolve(tree.type);

	const children = tree.children?.map((child) => renderLayoutTree(child, registry, options));

	const aria = computeAriaProps(tree, options);
	const issues = tree.path ? filterIssuesForPath(tree.path, options?.issues) : undefined;

	const props: Record<string, unknown> = { key: tree.id, node: tree };
	if (aria !== undefined) props.aria = aria;
	if (issues !== undefined) props.issues = issues;

	return createElement(Component, props as unknown as LayoutRendererProps, children);
}

function computeAriaProps(node: LayoutNode, options?: RenderTreeOptions) {
	if (!node.path) return undefined;
	const path = node.path;

	const pathIssues = filterIssuesForPath(path, options?.issues);
	const required = options?.requiredPaths?.has(path) ?? false;

	const props = getFieldProps(path, {
		issues: pathIssues,
		required,
	});
	const describedBy = props["aria-describedby"]
		?.split(" ")
		.map((id) => (id.endsWith("-description") ? descriptionId(path) : errorId(path)))
		.join(" ");
	return {
		...props,
		id: fieldId(path),
		...(describedBy ? { "aria-describedby": describedBy } : {}),
		...(props["aria-errormessage"] ? { "aria-errormessage": errorId(path) } : {}),
	};
}

function filterIssuesForPath(path: string, issues?: readonly ValidationIssue[]): readonly ValidationIssue[] {
	if (!issues || issues.length === 0) return [];
	return issues.filter((i) => i.path.segments.join(".") === path);
}
