import type { CreateKaladaV1HostOptions } from "@formbar/declarative";
import { evaluateBoolean, record, sourceRef, staticRef } from "./kalada-demo-inventory";
import type { DemoSession, Node } from "./kalada-demo-session";
import type { Context, Reference, Scope } from "./kalada-demo-store";

export type ArrayRequest = Parameters<
	NonNullable<NonNullable<CreateKaladaV1HostOptions["installed"]>["arrayHost"]>["mutateArray"]
>[1];
type Scopes = Readonly<Record<string, Reference["path"]>>;
type Walk = { session: DemoSession; context: Context; request: ArrayRequest; scope: Scope; scopes: Scopes };

function children(walk: Walk, node: Node, branch: string): boolean {
	const items = node[branch];
	return Array.isArray(items) && items.some((item) => allowedNode(walk, item));
}

function enterRow(walk: Walk, node: Node): boolean {
	if (!sourceRef(node.binding) || typeof node.scope !== "string") return false;
	const ref = staticRef(node.binding, walk.scopes);
	const path = walk.session.store.locate(ref, walk.scope);
	const token = walk.request.scope.rows[walk.scope.rows.length];
	if (!path || token?.name !== node.scope || !walk.session.store.rowsAt(path)?.some((row) => row.token === token.token))
		return false;
	return children(
		{
			...walk,
			scope: { rows: [...walk.scope.rows, token] },
			scopes: { ...walk.scopes, [node.scope]: [...ref.path, { row: node.scope }] },
		},
		node,
		"children",
	);
}

function allowedNode(walk: Walk, raw: unknown): boolean {
	if (!record(raw)) return false;
	const gate = (program: unknown, fallback: boolean) =>
		evaluateBoolean(walk.session, walk.context, program, walk.scope, walk.scopes, fallback);
	if (!gate(raw.visible, true) || gate(raw.disabled, false) || gate(raw.readOnly, false)) return false;
	if (raw.type === "action")
		return (
			raw.action === walk.request.operation &&
			sourceRef(raw.target) &&
			JSON.stringify(staticRef(raw.target, walk.scopes)) === JSON.stringify(walk.request.target) &&
			walk.scope.rows.length === walk.request.scope.rows.length
		);
	if (raw.type === "repeater") return enterRow(walk, raw);
	if (raw.type === "conditional") return children(walk, raw, gate(raw.condition, false) ? "then" : "else");
	return ["children", "tabs", "items"].some((name) => children(walk, raw, name));
}

export function arrayActionAllowed(session: DemoSession, context: Context, request: ArrayRequest) {
	try {
		return allowedNode(
			{ session, context, request, scope: { rows: [] }, scopes: {} },
			session.authority.definition?.root,
		);
	} catch {
		return false;
	}
}
