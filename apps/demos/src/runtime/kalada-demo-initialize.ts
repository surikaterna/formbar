import { copyJson } from "@formbar/expressions";
import {
	captureInitialPayload,
	ownInitialValue,
	stageInitialData,
	validateInitialPaths,
} from "./kalada-demo-initial-data";
import { initialTypeAllowed } from "./kalada-demo-initial-types";
import type { DemoSession } from "./kalada-demo-session";
import { empty } from "./kalada-demo-state";
import type { Context, Strategy } from "./kalada-demo-store";

type Request = Parameters<NonNullable<Strategy["initializeSchema"]>>[1];
function prepareInitial(session: DemoSession, request: Request) {
	const candidate = stageInitialData(session, captureInitialPayload(request));
	validateInitialPaths(session, candidate);
	if (session.authority.schema && !initialTypeAllowed(session.authority.schema, candidate))
		throw new TypeError("Invalid initial schema type");
	const baseline = structuredClone(copyJson(candidate));
	const data = structuredClone(baseline);
	return { baseline, data, arbiter: session.arbiter.stage(baseline) };
}

function commitInitial(session: DemoSession, prepared: ReturnType<typeof prepareInitial>) {
	const { store } = session;
	const previous = session.arbiter;
	const revision = {};
	// All staged work and authorization checks finish before the first live assignment or callback.
	session.arbiter = prepared.arbiter;
	store.data = prepared.data;
	store.initial = prepared.baseline;
	store.revision = revision;
	store.rows.clear();
	store.fields.clear();
	store.issueRecords = [];
	store.scopedIssues.clear();
	store.status = empty();
	store.invalidate();
	previous.dispose();
	store.notify();
	return { status: "applied" as const, revision };
}

export function initializeDemo(
	session: DemoSession,
	context: Context,
	request: Parameters<NonNullable<Strategy["initializeSchema"]>>[1],
) {
	const { store } = session;
	const revision = store.revision;
	const epoch = session.epoch;
	let prepared: ReturnType<typeof prepareInitial>;
	try {
		if (
			!session.live(context, revision) ||
			ownInitialValue(request, "revision") !== revision ||
			ownInitialValue(request, "instance") !== context.instance
		)
			return { status: "stale" as const };
		if (ownInitialValue(request, "contract") !== "formbar-schema-initialization-v1")
			return { status: "denied" as const };
		prepared = prepareInitial(session, request);
	} catch {
		return { status: "denied" as const };
	}
	if (!session.live(context, revision) || session.epoch !== epoch) {
		prepared.arbiter.dispose();
		return { status: "stale" as const };
	}
	return commitInitial(session, prepared);
}
