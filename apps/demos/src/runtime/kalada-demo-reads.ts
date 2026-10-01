import { KALADA_V1_ARTIFACT } from "@formbar/declarative";
import { lineSubtotal } from "./kalada-demo-calculations";
import { enumerationAllowed } from "./kalada-demo-inventory";
import type { DemoSession } from "./kalada-demo-session";
import { clone } from "./kalada-demo-state";
import type { Context, Reference, Scope, Strategy } from "./kalada-demo-store";

export function readDemo(session: DemoSession, context: Context, token: object, ref: Reference, scope: Scope) {
	if (!session.live(context, token)) return { status: "stale" as const };
	if (ref.namespace === "ui") {
		if (
			scope.rows.length ||
			!session.authority.uiPaths?.some((path) => JSON.stringify(path) === JSON.stringify(ref.path))
		)
			return { status: "denied" as const };
		if (ref.path.length === 1 && ref.path[0] === "lineSubtotal") {
			if (!session.allowed({ namespace: "data", path: ["lineItems"] }, "array")) return { status: "denied" as const };
			const value = lineSubtotal(session.store.get(["lineItems"]));
			return value === undefined ? { status: "missing" as const } : { status: "found" as const, value };
		}
		if (!session.rules) return { status: "denied" as const };
		const value = session.arbiter.read(ref.path as (string | number)[]);
		return { status: "found" as const, value: value === undefined ? null : clone(value) };
	}
	if (!session.allowed(ref)) return { status: "denied" as const };
	const path = session.store.locate(ref, scope);
	if (!path) return { status: "missing" as const };
	const value = session.store.get(path);
	return { status: "found" as const, value: value === undefined ? null : clone(value) };
}

function enumerate(
	session: DemoSession,
	context: Context,
	token: object,
	scope: Scope,
	ref: Reference,
	name: string,
	capacity: number,
) {
	if (!session.live(context, token)) return { status: "stale" as const };
	if (!session.allowed(ref, "array")) return { status: "denied" as const };
	if (!enumerationAllowed(session, ref, name)) return { status: "denied" as const };
	const path = session.store.locate(ref, scope);
	const entries = path && session.store.rowsAt(path);
	if (!entries) return { status: "missing" as const };
	if (entries.length > capacity) return { status: "capacity" as const };
	return {
		status: "found" as const,
		rows: entries.map((row, order) => ({
			token: row.token,
			order,
			scope: { rows: [...scope.rows, { name, token: row.token }] },
			writeRevision: row.revision,
		})),
	};
}

export function captureDemo(session: DemoSession, context: Context): ReturnType<Strategy["capture"]> {
	const token = session.store.revision;
	return {
		token,
		instance: context.instance,
		read: (ref, scope) => readDemo(session, context, token, ref, scope),
		enumerateRows: (scope, ref, name, capacity) => enumerate(session, context, token, scope, ref, name, capacity),
	};
}

export function demoIdentity(session: DemoSession, context: Context) {
	const { identity } = session.authority;
	if (
		session.active &&
		context.policyGeneration === identity.generation &&
		context.policyFingerprint === identity.fingerprint
	)
		session.instance ??= context.instance;
	return {
		artifact: KALADA_V1_ARTIFACT,
		policyGeneration: identity.generation,
		policyFingerprint: identity.fingerprint,
	};
}
