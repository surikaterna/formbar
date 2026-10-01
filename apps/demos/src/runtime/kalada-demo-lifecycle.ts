import type { DemoSession } from "./kalada-demo-session";
import { clone, empty, key } from "./kalada-demo-state";
import type { Context, Strategy } from "./kalada-demo-store";
import { runDemoValidation } from "./kalada-demo-validation";

export async function validateDemo(
	session: DemoSession,
	context: Context,
	expected: object,
	fresh: () => boolean,
	operation?: Parameters<NonNullable<Strategy["validateLifecycle"]>>[1]["operation"],
	request?: Parameters<NonNullable<Strategy["validateLifecycle"]>>[1],
) {
	const { store } = session;
	if (!session.live(context, expected) || !fresh()) return { status: "stale" as const };
	if (request?.submissionAttempt !== undefined && request.submissionAttempt !== true)
		return { status: "denied" as const };
	if (
		request?.submissionAttempt &&
		(request.contract !== "formbar-lifecycle-v1" || request.instance !== context.instance || !operation?.fresh())
	)
		return { status: "denied" as const };
	const run = store.beginValidation();
	const cancel = () => {
		run.controller.abort();
		if (store.finishValidation(run)) store.notify();
	};
	operation?.signal.addEventListener("abort", cancel, { once: true });
	const issues = await runDemoValidation(store.validators, store.data, run.controller.signal, store.validatorOrigins);
	operation?.signal.removeEventListener("abort", cancel);
	if (!session.live(context, expected) || run.controller.signal.aborted || !fresh() || store.validation !== run) {
		if (store.finishValidation(run)) store.notify();
		return { status: "stale" as const };
	}
	store.finishValidation(run);
	store.applyIssues(issues);
	const published = session.publish(operation ? (revision) => operation.advance(revision) : undefined, (revision) => {
		if (request?.submissionAttempt && session.live(context, revision) && operation?.fresh())
			store.status.submitCount = Math.min(Number.MAX_SAFE_INTEGER, store.status.submitCount + 1);
	});
	if (!published.accepted) return { status: "stale" as const };
	return { status: store.status.valid ? ("applied" as const) : ("invalid" as const), revision: published.revision };
}

export function captureLifecycleDemo(
	session: DemoSession,
	context: Context,
): ReturnType<NonNullable<Strategy["captureLifecycle"]>> {
	const { store } = session;
	const revision = store.revision;
	if (!session.granted(context)) return { status: "denied" };
	return {
		instance: context.instance,
		revision,
		initial: clone(store.initial),
		form: {
			...store.status,
			issues: { schema: [...store.status.issues.schema], extension: [...store.status.issues.extension] },
		},
		field: ({ path, scope }) => {
			if (!session.live(context, revision)) return { status: "stale" };
			const ref = session.authority.fields[path];
			const location = ref && store.locate({ namespace: "data", path: ref }, scope);
			return location
				? { status: "found", value: fieldStatus(session, { path, scope }, location) }
				: { status: "missing" };
		},
	};
}

function fieldStatus(
	session: DemoSession,
	field: Parameters<typeof session.store.fields.read>[0],
	location: readonly (string | number)[],
) {
	const { store } = session;
	const fieldKey = store.fields.key(field);
	const issues = [
		...store.issueRecords.filter((issue) => key(issue.path) === key(location)),
		...[...store.scopedIssues.values()].filter((entry) => entry.fieldKey === fieldKey).flatMap((entry) => entry.issues),
	];
	return {
		...store.fields.read(field),
		submitCount: store.status.submitCount,
		validating: [...store.scopedRuns.values()].some((run) => run.fieldKey === fieldKey),
		valid: issues.length === 0,
		issues: {
			schema: issues.filter((issue) => issue.source === "schema").map((issue) => issue.message),
			extension: issues.filter((issue) => issue.source === "extension").map((issue) => issue.message),
		},
	};
}

export function resetDemo(
	session: DemoSession,
	context: Context,
	request: Parameters<NonNullable<Strategy["resetLifecycle"]>>[1],
) {
	if (
		!session.live(context, request.revision) ||
		request.instance !== context.instance ||
		request.contract !== "formbar-lifecycle-v1"
	)
		return { status: "stale" as const };
	const { store } = session;
	store.invalidate();
	store.data = clone(store.initial);
	store.rows.clear();
	store.fields.clear();
	store.issueRecords = [];
	store.scopedIssues.clear();
	store.status = empty();
	session.publish();
	return { status: "applied" as const, revision: store.revision };
}

export function submissionDemo(
	session: DemoSession,
	context: Context,
): ReturnType<NonNullable<Strategy["captureSubmission"]>> {
	return session.granted(context)
		? { status: "found", instance: context.instance, revision: session.store.revision, data: clone(session.store.data) }
		: { status: "denied" };
}

export function submitDemo(
	session: DemoSession,
	context: Context,
	request: Parameters<NonNullable<Strategy["submitCaptured"]>>[1],
	fresh: () => boolean,
) {
	if (!session.live(context, request.revision) || !fresh() || request.instance !== context.instance)
		return { status: "stale" as const };
	if (
		request.contract !== "formbar-submission-v1" ||
		JSON.stringify(session.store.data) !== JSON.stringify(request.data) ||
		!session.store.status.valid
	)
		return { status: "denied" as const };
	if (request.operation && !request.operation.complete()) return { status: "stale" as const };
	session.submit?.(clone(request.data));
	session.store.status.submitted = true;
	session.publish();
	return { status: "submitted" as const };
}
