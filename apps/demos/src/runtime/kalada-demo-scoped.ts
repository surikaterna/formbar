import { writeAllowed } from "./kalada-demo-inventory";
import type { DemoSession } from "./kalada-demo-session";
import { clone } from "./kalada-demo-state";
import type { Context, ScopedRun, Strategy } from "./kalada-demo-store";

type Request = Parameters<NonNullable<Strategy["notifyScopedValidation"]>>[1];
type Registration = Parameters<NonNullable<Strategy["installScopedValidation"]>>[1][number];

async function settle(
	session: DemoSession,
	context: Context,
	id: string,
	run: ScopedRun,
	entry: Registration,
	revision: object,
) {
	const { store } = session;
	let issues: Awaited<ReturnType<Registration["validate"]>>;
	try {
		issues = await entry.validate(clone(store.data), run.controller.signal);
	} catch {
		issues = [{ path: [], message: "Scoped validation failed", source: "extension" }];
	}
	if (store.scopedRuns.get(id) !== run) return;
	store.scopedRuns.delete(id);
	if (session.live(context, revision) && !run.controller.signal.aborted)
		store.scopedIssues.set(id, { fieldKey: run.fieldKey, issues });
	store.syncStatus();
	store.notify();
}

function schedule(session: DemoSession, context: Context, request: Request, entry: Registration) {
	const { store } = session;
	const fieldKey = store.fields.key(request.field);
	const id = JSON.stringify([entry.id, fieldKey]);
	const old = store.scopedRuns.get(id);
	old?.controller.abort();
	clearTimeout(old?.timer);
	const run: ScopedRun = { field: request.field, fieldKey, controller: new AbortController() };
	store.scopedRuns.set(id, run);
	store.scopedIssues.delete(id);
	run.timer = setTimeout(() => {
		void settle(session, context, id, run, entry, request.revision);
	}, entry.debounceMs ?? 0);
}

function notify(session: DemoSession, context: Context, request: Request) {
	const { store } = session;
	if (!session.live(context, request.revision) || request.instance !== context.instance)
		return { status: "stale" as const };
	const path = session.authority.fields[request.field.path];
	if (
		request.contract !== "formbar-lifecycle-v1" ||
		!["onChange", "onBlur"].includes(request.trigger) ||
		!path ||
		!writeAllowed(session, context, { namespace: "data", path }, request.field.scope)
	)
		return { status: "denied" as const };
	store.fields.mark(request.field, request.trigger === "onChange", true);
	store.status.touched = true;
	for (const entry of store.scopedValidators)
		if (entry.field === request.field.path && entry.trigger === request.trigger)
			schedule(session, context, request, entry);
	store.syncStatus();
	store.notify();
	return { status: "applied" as const, revision: store.revision };
}

export function scopedDemo(
	session: DemoSession,
): Pick<Strategy, "installScopedValidation" | "notifyScopedValidation" | "cancelScopedValidation"> {
	return {
		installScopedValidation(context, entries) {
			if (!session.granted(context)) return { status: "denied" };
			session.store.invalidate();
			session.store.scopedValidators = entries;
			return { status: "installed" };
		},
		notifyScopedValidation: (context, request) => notify(session, context, request),
		cancelScopedValidation(context) {
			if (session.granted(context)) {
				session.store.invalidate();
				session.store.notify();
			}
		},
	};
}
