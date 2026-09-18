import type { LayoutNode } from "@formbar/from-schema";
import type { InteractionTarget } from "./interaction.js";

export interface FieldNavigationNode {
	readonly kind: "field";
	readonly path: string;
}

export interface GroupNavigationNode {
	readonly kind: "group";
	readonly id: string;
	readonly aliases: readonly string[];
	readonly children: readonly NavigationNode[];
}

export type NavigationNode = FieldNavigationNode | GroupNavigationNode;

export interface FocusNavigationGroup {
	readonly id: string;
	readonly label: string;
	readonly synthetic: boolean;
	readonly fields: readonly FieldNavigationNode[];
}

export interface NavigationModel {
	readonly root: GroupNavigationNode;
	readonly fields: readonly FieldNavigationNode[];
	readonly groups: readonly FocusNavigationGroup[];
	readonly targets: readonly InteractionTarget[];
}

export type NavigationDiagnosticCode =
	| "duplicate-node-id"
	| "duplicate-interactive-path"
	| "missing-interactive-path"
	| "empty-interactive-path";

export interface NavigationDiagnostic {
	readonly code: NavigationDiagnosticCode;
	readonly nodeId: string;
	readonly message: string;
}

export type NavigationResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly diagnostics: readonly NavigationDiagnostic[] };

const IMPLICIT_ROOT = "$root";
const GENERAL_GROUP_ID = "$general";

/** Experimental pre-1.0 normalization used to keep the spike and renderer in parity. */
export function normalizeNavigation(layout: LayoutNode): NavigationResult<NavigationModel> {
	const diagnostics = validateLayout(layout);
	if (diagnostics.length > 0) return { ok: false, diagnostics };
	const entries = normalizeNode(layout);
	const fused = layout.type === "group" ? fuseLayoutRoot(layout.id, entries) : entries;
	const root = flattenSingleRootGroup({ kind: "group", id: IMPLICIT_ROOT, aliases: [], children: fused });
	const fields = collectFields(root);
	const groups = collectFocusGroups(layout);
	const targets: InteractionTarget[] = [
		...groups.map(({ id }) => ({ kind: "group" as const, id })),
		...fields.map(({ path }) => ({ kind: "field" as const, path })),
	];
	return { ok: true, value: { root, fields, groups, targets } };
}

function validateLayout(layout: LayoutNode): readonly NavigationDiagnostic[] {
	const ids = new Set<string>();
	const paths = new Set<string>();
	const diagnostics: NavigationDiagnostic[] = [];
	const visit = (node: LayoutNode): void => {
		if (ids.has(node.id)) diagnostics.push(duplicateId(node.id));
		ids.add(node.id);
		if (node.type === "field" || node.type === "array") validateInteractivePath(node, paths, diagnostics);
		for (const child of node.children ?? []) visit(child);
	};
	visit(layout);
	return diagnostics;
}

function validateInteractivePath(node: LayoutNode, paths: Set<string>, diagnostics: NavigationDiagnostic[]): void {
	if (node.path === undefined) {
		diagnostics.push(pathDiagnostic("missing-interactive-path", node));
		return;
	}
	if (node.path.trim().length === 0) {
		diagnostics.push(pathDiagnostic("empty-interactive-path", node));
		return;
	}
	if (paths.has(node.path)) diagnostics.push(duplicatePath(node.id, node.path));
	paths.add(node.path);
}

function duplicateId(nodeId: string): NavigationDiagnostic {
	return { code: "duplicate-node-id", nodeId, message: `Duplicate layout node id: ${nodeId}` };
}

function duplicatePath(nodeId: string, path: string): NavigationDiagnostic {
	return { code: "duplicate-interactive-path", nodeId, message: `Duplicate interactive field path: ${path}` };
}

function pathDiagnostic(code: NavigationDiagnosticCode, node: LayoutNode): NavigationDiagnostic {
	const condition = code === "missing-interactive-path" ? "missing" : "empty";
	return { code, nodeId: node.id, message: `Interactive ${node.type} node "${node.id}" has a ${condition} path` };
}

function normalizeNode(node: LayoutNode): readonly NavigationNode[] {
	if (node.type === "field" || node.type === "array") {
		if (node.path === undefined) return [];
		return [{ kind: "field", path: node.path }, ...normalizeChildren(node.children)];
	}
	const children = normalizeChildren(node.children);
	if (node.type !== "group" || children.length === 0) return node.type === "group" ? [] : children;
	return [collapseGroup({ kind: "group", id: node.id, aliases: [], children })];
}

function normalizeChildren(children: readonly LayoutNode[] | undefined): readonly NavigationNode[] {
	return (children ?? []).flatMap(normalizeNode);
}

function collapseGroup(group: GroupNavigationNode): GroupNavigationNode {
	let current = group;
	while (current.children.length === 1 && current.children[0]?.kind === "group") {
		const child = current.children[0];
		current = {
			kind: "group",
			id: current.id,
			aliases: [...current.aliases, child.id, ...child.aliases],
			children: child.children,
		};
	}
	return current;
}

function fuseLayoutRoot(id: string, entries: readonly NavigationNode[]): readonly NavigationNode[] {
	const group = entries[0];
	if (entries.length !== 1 || group?.kind !== "group" || group.id !== id) return entries;
	return [{ ...group, id: IMPLICIT_ROOT, aliases: [id, ...group.aliases] }];
}

function flattenSingleRootGroup(root: GroupNavigationNode): GroupNavigationNode {
	const groups = root.children.filter((child) => child.kind === "group");
	if (groups.length !== 1) return root;
	const group = groups[0];
	return {
		...root,
		aliases: [...root.aliases, ...(group.id === IMPLICIT_ROOT ? [] : [group.id]), ...group.aliases],
		children: root.children.flatMap((child) => (child === group ? group.children : child)),
	};
}

function collectFields(root: GroupNavigationNode): readonly FieldNavigationNode[] {
	const fields: FieldNavigationNode[] = [];
	const visit = (node: NavigationNode): void => {
		if (node.kind === "field") fields.push(node);
		else for (const child of node.children) visit(child);
	};
	visit(root);
	return fields;
}

function collectFocusGroups(layout: LayoutNode): readonly FocusNavigationGroup[] {
	const groups: FocusNavigationGroup[] = [];
	const generalFields: FieldNavigationNode[] = [];
	let generalIndex = -1;
	const visit = (node: LayoutNode): void => {
		if (node.type === "group") {
			const fields = collectLayoutFields(node);
			if (fields.length > 0) groups.push(focusGroup(node.id, groupLabel(node), fields));
			return;
		}
		if ((node.type === "field" || node.type === "array") && node.path !== undefined) {
			if (generalIndex < 0) generalIndex = groups.length;
			generalFields.push({ kind: "field", path: node.path });
		}
		for (const child of node.children ?? []) visit(child);
	};
	visit(layout);
	if (generalFields.length > 0) {
		groups.splice(generalIndex, 0, { id: GENERAL_GROUP_ID, label: "General", synthetic: true, fields: generalFields });
	}
	return groups;
}

function collectLayoutFields(node: LayoutNode): readonly FieldNavigationNode[] {
	const fields: FieldNavigationNode[] = [];
	const visit = (candidate: LayoutNode): void => {
		if ((candidate.type === "field" || candidate.type === "array") && candidate.path !== undefined) {
			fields.push({ kind: "field", path: candidate.path });
		}
		for (const child of candidate.children ?? []) visit(child);
	};
	visit(node);
	return fields;
}

function focusGroup(id: string, label: string, fields: readonly FieldNavigationNode[]): FocusNavigationGroup {
	return { id, label, synthetic: false, fields };
}

function groupLabel(node: LayoutNode): string {
	const title = node.props?.title;
	return typeof title === "string" && title.length > 0 ? title : node.id;
}
