import { validateFinal } from "./kalada-demo-final-validation";
import { inventoryDemo, record, removeOutgoing, sameInventory } from "./kalada-demo-inventory";
import { draftAllowsOmission } from "./kalada-demo-omission-origin";
import type { DemoSession } from "./kalada-demo-session";
import { clone } from "./kalada-demo-state";
import type { Context, OwnedIssue, Strategy, Validators } from "./kalada-demo-store";

type Request = Parameters<NonNullable<Strategy["captureOmission"]>>[1];
type Proof = {
	instance: object;
	revision: object;
	draft: string;
	outgoing: string;
	issues: readonly OwnedIssue[];
	validators: Validators;
};

function sameOrigins(session: DemoSession, issues: readonly OwnedIssue[], validators: Validators) {
	return session.store.issueRecords === issues && session.store.validators === validators;
}

function capture(
	session: DemoSession,
	context: Context,
	request: Request,
): ReturnType<NonNullable<Strategy["captureOmission"]>> {
	if (!session.live(context, request.revision) || request.instance !== context.instance) return { status: "stale" };
	const submission = session.authority.definition?.submission;
	const mode = record(submission) ? submission.hiddenValues : "include";
	if (request.contract !== "formbar-lifecycle-v1" || request.hiddenValues !== mode) return { status: "denied" };
	try {
		const fields = inventoryDemo(session, context);
		if (!sameInventory(fields, request.fields)) return { status: "conflict" };
		const candidate = clone(session.store.data);
		for (const field of fields) {
			if (field.visible || field.submitWhenHidden === "include" || mode === "include") continue;
			const target = session.authority.fields[field.field.path];
			const path = target && session.store.locate({ namespace: "data", path: target }, field.field.scope);
			if (!path) return { status: "denied" };
			removeOutgoing(candidate, path);
		}
		return { status: "found", instance: context.instance, revision: request.revision, candidate };
	} catch {
		return { status: "denied" };
	}
}

export function omissionDemo(
	session: DemoSession,
): Pick<Strategy, "captureOmission" | "validateOutgoingCandidate" | "submitOmission"> {
	const proofs = new WeakMap<object, Proof>();
	return {
		captureOmission: (context, request) => capture(session, context, request),
		validateOutgoingCandidate: (context, request, fresh) => validate(session, context, request, fresh, proofs),
		submitOmission: (context, request, fresh) => submit(session, context, request, fresh, proofs),
	};
}

async function validate(
	session: DemoSession,
	context: Context,
	request: Parameters<NonNullable<Strategy["validateOutgoingCandidate"]>>[1],
	fresh: () => boolean,
	proofs: WeakMap<object, Proof>,
) {
	const captured = capture(session, context, request);
	const bytes = JSON.stringify(request.candidate);
	if (!fresh() || captured.status !== "found" || JSON.stringify(captured.candidate) !== bytes)
		return { status: "conflict" as const };
	const draft = JSON.stringify(session.store.data);
	if (!draftAllowsOmission(session, context, request)) return { status: "invalid" as const };
	const issuesAtCapture = session.store.issueRecords;
	const validators = session.store.validators;
	const signal = session.store.controller.signal;
	try {
		const issues = await validateFinal(session, request.candidate, request.operation?.signal);
		if (
			!fresh() ||
			signal.aborted ||
			!session.live(context, request.revision) ||
			draft !== JSON.stringify(session.store.data)
		)
			return { status: "stale" as const };
		const current = capture(session, context, request);
		if (current.status !== "found" || JSON.stringify(current.candidate) !== bytes)
			return { status: "conflict" as const };
		if (issues.length) return { status: "invalid" as const };
		if (!sameOrigins(session, issuesAtCapture, validators) || !draftAllowsOmission(session, context, request))
			return { status: "stale" as const };
		const proof = {};
		proofs.set(proof, {
			instance: context.instance,
			revision: request.revision,
			draft,
			outgoing: bytes,
			issues: issuesAtCapture,
			validators,
		});
		return { status: "applied" as const, revision: request.revision, proof };
	} catch {
		return { status: "invalid" as const };
	}
}

function submit(
	session: DemoSession,
	context: Context,
	request: Parameters<NonNullable<Strategy["submitOmission"]>>[1],
	fresh: () => boolean,
	proofs: WeakMap<object, Proof>,
) {
	const proof = proofs.get(request.proof);
	proofs.delete(request.proof);
	const captured = capture(session, context, request);
	if (
		!fresh() ||
		captured.status !== "found" ||
		!proof ||
		proof.instance !== context.instance ||
		proof.revision !== request.revision ||
		proof.draft !== JSON.stringify(session.store.data) ||
		proof.outgoing !== JSON.stringify(request.candidate) ||
		proof.outgoing !== JSON.stringify(captured.candidate) ||
		proof.issues !== session.store.issueRecords ||
		proof.validators !== session.store.validators ||
		!draftAllowsOmission(session, context, request)
	)
		return { status: "denied" as const };
	if (request.operation && !request.operation.complete()) return { status: "stale" as const };
	session.submit?.(clone(request.candidate));
	session.store.status.submitted = true;
	session.publish();
	return { status: "submitted" as const };
}
