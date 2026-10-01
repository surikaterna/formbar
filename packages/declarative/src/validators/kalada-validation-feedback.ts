import type { AdmittedDefinition, AdmittedNode } from "./kalada-definition.js";
import type { PreparedControl, PreparedNodeView } from "./kalada-prepared-view.js";
import { ProgramAdmissionError } from "./kalada-program.js";
import { staticDependencyKey } from "./static-references.js";

function logicalTarget(admitted: AdmittedDefinition, node: AdmittedNode) {
	const target = admitted.targets.get(`${node.path}.binding`);
	return target && JSON.stringify([node.enclosingScope ?? null, staticDependencyKey(target)]);
}

/** Aliases select one admitted field resource in the SAME lexical scope, never all equal-path issues. */
export function validationFieldAliases(admitted: AdmittedDefinition) {
	const fields = new Map<string, { path: string; ambiguous: boolean }>();
	for (const field of admitted.fields.values()) {
		const key = logicalTarget(admitted, field);
		if (!key) continue;
		const prior = fields.get(key);
		if (prior) prior.ambiguous = true;
		else fields.set(key, { path: field.path, ambiguous: false });
	}
	const result = new Map<string, string>();
	for (const node of admitted.nodes.values()) {
		if (node.type !== "validation") continue;
		const key = logicalTarget(admitted, node);
		const owners = key && fields.get(key);
		if (!owners) throw new ProgramAdmissionError(`${node.path}.binding`, "VALIDATION_FIELD_MISSING");
		if (owners.ambiguous) throw new ProgramAdmissionError(`${node.path}.binding`, "AMBIGUOUS_VALIDATION_FIELD");
		result.set(node.path, owners.path);
	}
	return result;
}

function feedback(node: PreparedNodeView, controls: ReadonlyMap<string, PreparedControl>, submitted: boolean) {
	const control = node.validationFor && controls.get(node.validationFor);
	if (!control) return undefined;
	const status = control.lifecycle;
	if (!status) throw new ProgramAdmissionError(node.path, "LIFECYCLE_UNAVAILABLE");
	const issues = [...status.issues.schema, ...status.issues.extension];
	if (status.valid || !issues.length || !(status.dirty || status.touched || status.submitted || submitted))
		return undefined;
	return Object.freeze({ ...node, lifecycle: status, issues: node.issues ?? issues });
}

/** Deferred projection is order-independent and reuses the authorized field lifecycle snapshot unchanged. */
export function resolveValidationFeedback(
	tree: PreparedNodeView,
	entries: readonly PreparedControl[],
	submitted: boolean,
) {
	const controls = new Map(entries.map((control) => [control.key, control]));
	const list = (nodes: readonly PreparedNodeView[]) =>
		nodes.flatMap((node) => {
			const result = visit(node);
			return result ? [result] : [];
		});
	const visit = (node: PreparedNodeView): PreparedNodeView | undefined => {
		if (node.type === "validation") return feedback(node, controls, submitted);
		return Object.freeze({
			...node,
			...(node.children ? { children: list(node.children) } : {}),
			...(node.items ? { items: node.items.map((item) => ({ ...item, children: list(item.children) })) } : {}),
			...(node.rows ? { rows: node.rows.map((row) => ({ ...row, children: list(row.children) })) } : {}),
		});
	};
	return visit(tree);
}
