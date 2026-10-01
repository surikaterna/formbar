import type { DefinitionProgram, JsonValue } from "@formbar/declarative";
import { compileKaladaV1Program } from "@kalada/core";
import { readDemo } from "./kalada-demo-reads";
import type { DemoSession, Node } from "./kalada-demo-session";
import type { Context, Reference, Scope, Strategy } from "./kalada-demo-store";

type Ref = Extract<DefinitionProgram["expression"], { kind: "ref" }>["ref"];
type Scopes = Readonly<Record<string, Reference["path"]>>;
type Field = Parameters<NonNullable<Strategy["captureOmission"]>>[1]["fields"][number];
type OwnedField = Field & { readonly disabled: boolean; readonly readOnly: boolean };
type Flags = { visible: boolean; disabled: boolean; readOnly: boolean };
export const record = (value: unknown): value is Node => !!value && typeof value === "object" && !Array.isArray(value);

export function sourceRef(value: unknown): value is Ref {
	return (
		record(value) &&
		["data", "ui"].includes(String(value.namespace)) &&
		Array.isArray(value.segments) &&
		value.segments.every(
			(part) => typeof part === "string" && !["__proto__", "constructor", "prototype"].includes(part),
		) &&
		(value.scope === undefined || typeof value.scope === "string")
	);
}

export function staticRef(ref: Ref, scopes: Scopes): Reference {
	const prefix = ref.scope ? scopes[ref.scope] : [];
	if (!prefix) throw new TypeError("Unknown lexical scope");
	return { namespace: ref.namespace, path: [...prefix, ...ref.segments] };
}

export function evaluateBoolean(
	session: DemoSession,
	context: Context,
	program: unknown,
	scope: Scope,
	scopes: Scopes,
	fallback: boolean,
) {
	if (program === undefined) return fallback;
	const compiled = compileKaladaV1Program<Ref>(program, { reference: { validate: sourceRef } });
	if (!compiled.ok) throw new TypeError("Invalid installed visibility program");
	const result = compiled.value.evaluate((ref) => {
		const target = staticRef(ref, scopes);
		const read = readDemo(session, context, session.store.revision, target, ref.scope ? scope : { rows: [] });
		return read.status === "found" ? { found: true, value: read.value } : { found: false, reason: "denied" };
	});
	if (!result.ok || typeof result.value !== "boolean") throw new TypeError("Boolean visibility required");
	return result.value;
}

function branch(
	session: DemoSession,
	context: Context,
	node: Node,
	name: string,
	at: string,
	scope: Scope,
	scopes: Scopes,
	flags: Flags,
): OwnedField[] {
	const children = node[name];
	if (!Array.isArray(children)) return [];
	return children.flatMap((child, index) =>
		inventoryNode(session, context, child, `${at}.${name}[${index}]`, scope, scopes, flags),
	);
}

function repeater(
	session: DemoSession,
	context: Context,
	node: Node,
	at: string,
	scope: Scope,
	scopes: Scopes,
	flags: Flags,
): OwnedField[] {
	if (!sourceRef(node.binding) || typeof node.scope !== "string") throw new TypeError("Invalid repeater");
	const ref = staticRef(node.binding, scopes);
	if (!session.allowed(ref, "array")) throw new TypeError("Unattested repeater");
	const path = session.store.locate(ref, scope);
	const rows = path && session.store.rowsAt(path);
	if (!rows) return [];
	const name = node.scope;
	const next = { ...scopes, [name]: [...ref.path, { row: name }] };
	return rows.flatMap((row) =>
		branch(session, context, node, "children", at, { rows: [...scope.rows, { name, token: row.token }] }, next, flags),
	);
}

function inventoryNode(
	session: DemoSession,
	context: Context,
	raw: unknown,
	at: string,
	scope: Scope,
	scopes: Scopes,
	parent: Flags,
): OwnedField[] {
	if (!record(raw)) throw new TypeError("Invalid installed node");
	const visible = parent.visible && evaluateBoolean(session, context, raw.visible, scope, scopes, true);
	const disabled =
		parent.disabled || (visible && evaluateBoolean(session, context, raw.disabled, scope, scopes, false));
	const readOnly =
		parent.readOnly || (visible && evaluateBoolean(session, context, raw.readOnly, scope, scopes, false));
	const flags = { visible, disabled, readOnly };
	if (raw.type === "field")
		return [
			{
				field: { path: at, scope },
				...flags,
				...(raw.submitWhenHidden === "include" ? { submitWhenHidden: "include" as const } : {}),
			},
		];
	if (raw.type === "repeater") return repeater(session, context, raw, at, scope, scopes, flags);
	if (raw.type === "conditional") {
		const yes = visible && evaluateBoolean(session, context, raw.condition, scope, scopes, false);
		return [
			...branch(session, context, raw, "then", at, scope, scopes, { ...flags, visible: yes }),
			...branch(session, context, raw, "else", at, scope, scopes, { ...flags, visible: visible && !yes }),
		];
	}
	if (raw.type === "tabs" || raw.type === "accordion") {
		const name = raw.type === "tabs" ? "tabs" : "items";
		const entries = raw[name];
		return Array.isArray(entries)
			? entries.flatMap((entry, index) =>
					record(entry)
						? branch(session, context, entry, "children", `${at}.${name}[${index}]`, scope, scopes, flags)
						: [],
				)
			: [];
	}
	return branch(session, context, raw, "children", at, scope, scopes, flags);
}

export function inventoryDemo(session: DemoSession, context: Context): readonly OwnedField[] {
	return inventoryNode(
		session,
		context,
		session.authority.definition?.root,
		"root",
		{ rows: [] },
		{},
		{ visible: true, disabled: false, readOnly: false },
	);
}

export function writeAllowed(session: DemoSession, context: Context, ref: Reference, scope: Scope) {
	try {
		return inventoryDemo(session, context).some((entry) => {
			const path = session.authority.fields[entry.field.path];
			return (
				entry.visible &&
				!entry.disabled &&
				!entry.readOnly &&
				JSON.stringify(path) === JSON.stringify(ref.path) &&
				entry.field.scope.rows.length === scope.rows.length &&
				entry.field.scope.rows.every(
					(row, index) => row.name === scope.rows[index]?.name && row.token === scope.rows[index]?.token,
				)
			);
		});
	} catch {
		return false;
	}
}

export function enumerationAllowed(session: DemoSession, ref: Reference, name: string) {
	return repeaters(session.authority.definition?.root, {}).some(
		(entry) => entry.name === name && JSON.stringify(entry.ref) === JSON.stringify(ref),
	);
}

function repeaters(raw: unknown, scopes: Scopes): { name: string; ref: Reference }[] {
	if (!record(raw)) return [];
	const own =
		raw.type === "repeater" && sourceRef(raw.binding) && typeof raw.scope === "string"
			? [{ name: raw.scope, ref: staticRef(raw.binding, scopes) }]
			: [];
	const next = own.length ? { ...scopes, [own[0].name]: [...own[0].ref.path, { row: own[0].name }] } : scopes;
	const children = ["children", "then", "else", "tabs", "items"].flatMap((key) =>
		Array.isArray(raw[key]) ? raw[key] : [],
	);
	return [...own, ...children.flatMap((child) => repeaters(child, next))];
}

export function sameInventory(expected: readonly Field[], actual: readonly Field[]) {
	return (
		expected.length === actual.length &&
		expected.every((entry, index) => {
			const item = actual[index];
			return (
				item?.field.path === entry.field.path &&
				item.visible === entry.visible &&
				item.submitWhenHidden === entry.submitWhenHidden &&
				item.field.scope.rows.length === entry.field.scope.rows.length &&
				entry.field.scope.rows.every(
					(row, i) => row.name === item.field.scope.rows[i]?.name && row.token === item.field.scope.rows[i]?.token,
				)
			);
		})
	);
}

export function removeOutgoing(candidate: JsonValue, path: readonly (string | number)[]) {
	let cursor: JsonValue | undefined = candidate;
	for (const part of path.slice(0, -1)) {
		if (!cursor || typeof cursor !== "object") return;
		cursor = (cursor as Record<string | number, JsonValue>)[part];
	}
	if (cursor && typeof cursor === "object")
		delete (cursor as Record<string | number, JsonValue>)[path[path.length - 1] as string];
}
