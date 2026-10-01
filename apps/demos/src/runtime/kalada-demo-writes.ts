import type { CreateKaladaV1HostOptions } from "@formbar/declarative";
import { arrayActionAllowed } from "./kalada-demo-action-authority";
import { writeAllowed } from "./kalada-demo-inventory";
import type { DemoSession } from "./kalada-demo-session";
import { clone, currentRow, key } from "./kalada-demo-state";
import type { Context, Reference, Strategy } from "./kalada-demo-store";

type Write = Parameters<NonNullable<Strategy["writeDirect"]>>[1];
type ArrayHost = NonNullable<NonNullable<CreateKaladaV1HostOptions["installed"]>["arrayHost"]>;
type ArrayRequest = Parameters<ArrayHost["mutateArray"]>[1];

export function writeDemo(session: DemoSession, context: Context, request: Write) {
	const { store } = session;
	if (!session.live(context, request.expectedRevision) || request.expectedInstance !== context.instance)
		return { status: "stale" as const };
	if (request.contract !== "formbar-direct-write-v1" || !session.allowed(request.reference, "value"))
		return { status: "denied" as const };
	if (request.targetKind === "row-value" && request.value === null) return { status: "denied" as const };
	if (!session.authority.valueAllowed(request.reference, request.value)) return { status: "denied" as const };
	if (!writeAllowed(session, context, request.reference, request.scope)) return { status: "denied" as const };
	const path = store.locate(request.reference, request.scope);
	if (!path?.length || (request.targetKind !== "non-repeater") !== request.scope.rows.length > 0)
		return { status: "invalid-target" as const };
	if (
		request.targetKind !== "non-repeater" &&
		!currentRow(store.rows, request.reference, request.scope, path, request.expectedRowRevision)
	)
		return { status: "stale" as const };
	const whole = typeof request.reference.path.at(-1) === "object";
	if (
		request.targetKind === "row-value" &&
		(!whole || typeof path.at(-1) !== "number" || !Array.isArray(store.get(path.slice(0, -1))))
	)
		return { status: "invalid-target" as const };
	if (request.targetKind === "row" && whole) return { status: "invalid-target" as const };
	store.changed(true);
	store.put(path, request.value);
	invalidateDescendants(session, path);
	store.retireFields();
	if (request.scope.rows.length) {
		const marker = request.reference.path.findLastIndex((part) => typeof part === "object");
		const row = store.rows.get(key(path.slice(0, marker)))?.[Number(path[marker])];
		if (row) row.revision = {};
	}
	session.publish();
	return { status: "applied" as const };
}

function invalidateDescendants(session: DemoSession, path: readonly (string | number)[]) {
	for (const id of session.store.rows.keys()) {
		const candidate = JSON.parse(id) as (string | number)[];
		if (candidate.length >= path.length && path.every((part, index) => candidate[index] === part))
			session.store.rows.delete(id);
	}
}

function reindexDescendants(
	session: DemoSession,
	path: readonly (string | number)[],
	oldTokens: readonly object[],
	newTokens: readonly object[],
) {
	const updates: [string, string | undefined][] = [];
	for (const id of session.store.rows.keys()) {
		const child = JSON.parse(id) as (string | number)[];
		if (child.length <= path.length || !path.every((part, index) => child[index] === part)) continue;
		const old = child[path.length];
		if (typeof old !== "number") continue;
		const next = newTokens.indexOf(oldTokens[old]);
		updates.push([id, next < 0 ? undefined : key([...path, next, ...child.slice(path.length + 1)])]);
	}
	const values = updates.map(([old, next]) => [next, session.store.rows.get(old)] as const);
	for (const [old] of updates) session.store.rows.delete(old);
	for (const [next, rows] of values) if (next && rows) session.store.rows.set(next, rows);
}

function indices(entries: readonly { token: object; revision: object }[], request: ArrayRequest) {
	const find = (row: ArrayRequest["row"]) =>
		row ? entries.findIndex((entry) => entry.token === row.token && entry.revision === row.revision) : -1;
	return { index: find(request.row), target: find(request.destination) };
}

function applyArray(
	list: unknown[],
	entries: { token: object; revision: object; value: unknown }[],
	request: ArrayRequest,
	index: number,
	target: number,
) {
	if (request.operation === "array.append" || request.operation === "array.insert") {
		const at = request.operation === "array.append" ? list.length : target;
		if (at < 0 || request.payload === undefined) return false;
		list.splice(at, 0, clone(request.payload));
		entries.splice(at, 0, { token: {}, revision: {}, value: clone(request.payload) });
		return true;
	}
	if (index < 0) return false;
	if (request.operation === "array.remove") {
		list.splice(index, 1);
		entries.splice(index, 1);
		return true;
	}
	if (target < 0) return false;
	if (request.operation === "array.swap") {
		[list[index], list[target]] = [list[target], list[index]];
		[entries[index], entries[target]] = [entries[target], entries[index]];
	} else if (request.operation === "array.move") {
		list.splice(target, 0, ...list.splice(index, 1));
		entries.splice(target, 0, ...entries.splice(index, 1));
	} else return false;
	return true;
}

function boundsAllowed(session: DemoSession, ref: Reference, request: ArrayRequest, length: number) {
	const limits = session.authority.arrayBounds?.[JSON.stringify(ref.path)];
	if (!limits || request.minItems !== limits.minItems || request.maxItems !== limits.maxItems) return false;
	if (request.operation === "array.remove") return length > (limits.minItems ?? 0);
	if (["array.append", "array.insert"].includes(request.operation)) return length < (limits.maxItems ?? 256);
	return true;
}

export function mutateDemoArray(session: DemoSession, context: Context, request: ArrayRequest) {
	const { store } = session;
	if (!session.live(context, request.revision) || request.instance !== context.instance)
		return { status: "stale" as const };
	if (request.contract !== "formbar-array-action-v1" || !session.allowed(request.target, "array"))
		return { status: "denied" as const };
	if (!arrayActionAllowed(session, context, request)) return { status: "denied" as const };
	const parent = request.row ? { rows: request.scope.rows.slice(0, -1) } : request.scope;
	if (request.row && request.scope.rows.at(-1)?.token !== request.row.token) return { status: "denied" as const };
	const path = store.locate(request.target, parent);
	const list = path && store.get(path);
	const entries = path && store.rowsAt(path);
	if (!Array.isArray(list) || !entries) return { status: "missing" as const };
	const { index, target } = indices(entries, request);
	if ((request.row && index < 0) || (request.destination && target < 0)) return { status: "stale" as const };
	if (!boundsAllowed(session, request.target, request, list.length)) return { status: "denied" as const };
	if (
		["array.append", "array.insert"].includes(request.operation) &&
		(request.payload === undefined || !session.authority.valueAllowed(request.target, [...list, request.payload]))
	)
		return { status: "invalid" as const };
	const tokens = entries.map((row) => row.token);
	if (
		(request.operation === "array.insert" && target < 0) ||
		(["array.remove", "array.move", "array.swap"].includes(request.operation) && index < 0) ||
		(["array.move", "array.swap"].includes(request.operation) && target < 0)
	)
		return { status: "invalid" as const };
	if (request.operationFence && !request.operationFence.complete()) return { status: "stale" as const };
	if (!applyArray(list, entries, request, index, target)) return { status: "invalid" as const };
	reindexDescendants(
		session,
		path,
		tokens,
		entries.map((row) => row.token),
	);
	store.changed();
	store.retireFields();
	session.publish();
	return { status: "applied" as const };
}
