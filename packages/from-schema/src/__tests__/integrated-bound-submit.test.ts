import { originalIssueSource } from "@formbar/core/internal/scoped-sync";
import { activateBoundSubmit, boundSubmitStore } from "@formbar/core/internal/submit-proof";
import { expect, test, vi } from "vitest";
import { renderableIssues } from "../../../core/src/attempt-issues.js";
import { publishIssueOnly } from "../../../core/src/store.js";
import { createSchemaForm, jsonSchemaProvider } from "../index.js";

const definition = {
	version: 1 as const,
	id: "integrated-bound-submit",
	submission: { hiddenValues: "omit-inactive" as const },
	root: {
		type: "group" as const,
		id: "root",
		children: [
			{
				type: "field" as const,
				id: "secret",
				widget: "text",
				binding: { namespace: "data" as const, segments: ["secret"] },
				visible: { kind: "literal" as const, value: false },
			},
			{
				type: "field" as const,
				id: "pinned",
				widget: "text",
				binding: { namespace: "data" as const, segments: ["pinned"] },
				visible: { kind: "literal" as const, value: false },
				submitWhenHidden: "include" as const,
			},
			{
				type: "field" as const,
				id: "name",
				widget: "text",
				binding: { namespace: "data" as const, segments: ["name"] },
			},
		],
	},
};

function fixture() {
	const seen: { kind: string; data: unknown; uiState: unknown; stage?: string; context?: unknown }[] = [];
	const record = (kind: string) => (input: { data: unknown; uiState: unknown; stage?: string; context?: unknown }) => {
		seen.push({ ...input, kind });
		return [];
	};
	const prepared = createSchemaForm(
		{
			type: "object",
			properties: { secret: { type: "string" }, name: { type: "string" } },
			required: ["name"],
		},
		{
			provider: jsonSchemaProvider(),
			side: "input",
			definition,
			validators: [record("prepared")],
			fieldValidators: [
				{
					fieldId: "secret",
					validate: ({ data }: { data: unknown }) =>
						data && typeof data === "object" && "secret" in data
							? [{ code: "hidden", message: "same", severity: "error" as const }]
							: [],
				},
			],
			asyncFieldValidators: [
				{ id: "name-async", fieldId: "name", validate: async (input) => record("scoped-async")(input) },
			],
		},
	);
	const handler = vi.fn(async (_input: { payload: unknown }) => ({ ok: true as const }));
	const form = prepared.createForm({
		initialData: { secret: "draft", pinned: "keep", name: "Ada" },
		initialUiState: { tab: "review" },
		validators: [record("core")],
		asyncValidators: [{ id: "caller-async", validate: async (input) => record("caller-async")(input) }],
		transforms: [{ id: "final-copy", phase: "egress", transform: (data) => ({ ...data }) }],
		onSubmit: handler,
	});
	const store = boundSubmitStore(form);
	if (!store) throw Error("missing bound store");
	activateBoundSubmit(form);
	return { form, store, handler, seen };
}

const context = { requestId: "integrated", at: "2026-01-01T00:00:00.000Z" };

function stageReview({ store }: ReturnType<typeof fixture>) {
	const stageTx = store.beginTransaction();
	stageTx.mutate((state) => ({ ...state, meta: { ...state.meta, stage: "review" } }));
	store.commitTransaction(stageTx);
}

function certifiedBlockers({ form, store }: ReturnType<typeof fixture>) {
	const original = form.validate("review").find((issue) => issue.code === "hidden");
	if (!original) throw Error("missing certified hidden issue");
	expect(originalIssueSource(original)).toBeDefined();
	const unowned = {
		...original,
		path: { ...original.path, segments: [...original.path.segments] },
		source: { ...original.source },
	};
	const root = {
		code: "root-block",
		message: "root-block",
		severity: "error" as const,
		path: { namespace: "data" as const, segments: [] },
		source: { origin: "rule" as const, validatorId: "root-block" },
	};
	publishIssueOnly(store, [original, unowned, root]);
	return { original, unowned, root };
}

async function rejectIndependentBlockers(f: ReturnType<typeof fixture>) {
	const { form, handler } = f;
	const { original, unowned, root } = certifiedBlockers(f);
	const draft = form.getState().data;
	const blocked = await form.submit(context);
	expect(blocked).toMatchObject({ ok: false, reason: "validation-failed" });
	expect(blocked.fieldIssues).toEqual(expect.arrayContaining([unowned, root]));
	expect(blocked.fieldIssues).toHaveLength(2);
	expect(blocked.fieldIssues).not.toContain(original);
	expect(form.getState().attemptValidation).toMatchObject({ status: "failed" });
	expect(renderableIssues(form.getState())).toHaveLength(3);
	expect(renderableIssues(form.getState())).toEqual(expect.arrayContaining([original, unowned, root]));
	expect(form.getState().issues).toContain(original);
	expect(form.getState().data).toBe(draft);
	expect(handler).not.toHaveBeenCalled();
	return form.getState().attemptValidation?.submitId;
}

async function supersedeBlockedAttempt(f: ReturnType<typeof fixture>, previousId: string) {
	const { form, handler } = f;
	const { original, unowned, root } = certifiedBlockers(f);
	const publications: { submitId: string; blockers: unknown; renderable: unknown; submission: unknown }[] = [];
	const succeededIds: string[] = [];
	let write: ReturnType<typeof form.setValue> | undefined;
	let writing = false;
	const stop = form.subscribe((state) => {
		const attempt = state.attemptValidation;
		if (attempt?.status === "succeeded" && state.meta.submission?.status === "running") {
			succeededIds.push(attempt.submitId);
		}
		if (attempt?.status !== "failed" || attempt.submitId === previousId || writing) return;
		if (state.meta.submission?.status !== "running") return;
		if (!succeededIds.includes(attempt.submitId) || attempt.issues.length !== 0) return;
		writing = true;
		publications.push({
			submitId: attempt.submitId,
			blockers: state.issues,
			renderable: renderableIssues(state),
			submission: state.meta.submission.status,
		});
		write = form.setValue("name", "Grace");
	});
	const stale = await form.submit(context);
	stop();
	assertSupersededBlockers(f, { original, unowned, root }, publications, succeededIds, previousId, write, stale);
	return { draft: form.getState().data, submitId: publications[0]?.submitId };
}

function assertSupersededBlockers(
	{ form, handler }: ReturnType<typeof fixture>,
	issues: ReturnType<typeof certifiedBlockers>,
	publications: { submitId: string; blockers: unknown; renderable: unknown; submission: unknown }[],
	succeededIds: string[],
	previousId: string,
	write: ReturnType<ReturnType<typeof fixture>["form"]["setValue"]> | undefined,
	stale: Awaited<ReturnType<ReturnType<typeof fixture>["form"]["submit"]>>,
) {
	const { original, unowned, root } = issues;
	expect(publications).toHaveLength(1);
	expect(succeededIds).toEqual([publications[0]?.submitId]);
	expect(publications[0]).toMatchObject({ submitId: expect.any(String), submission: "running" });
	expect(publications[0]?.blockers).toHaveLength(3);
	expect(publications[0]?.renderable).toHaveLength(3);
	expect(publications[0]?.blockers).toEqual(expect.arrayContaining([original, unowned, root]));
	expect(publications[0]?.renderable).toEqual(expect.arrayContaining([original, unowned, root]));
	expect(publications[0]?.submitId).not.toBe(previousId);
	expect(write).toEqual({ ok: true });
	expect(stale).toMatchObject({ ok: false });
	expect(stale.reason).toMatch(/^(validation-superseded|aborted)$/);
	expect(stale.fieldIssues).toEqual([]);
	expect(handler).not.toHaveBeenCalled();
	expect(form.getState().attemptValidation?.submitId).not.toBe(publications[0]?.submitId);
	expect(form.getState().attemptValidation?.status).not.toBe("failed");
	expect(renderableIssues(form.getState())).not.toContain(unowned);
	expect(form.getState().data).toEqual({ secret: "draft", pinned: "keep", name: "Grace" });
}

async function retryChecked(
	{ form, store, handler, seen }: ReturnType<typeof fixture>,
	draft: unknown,
	previousId: string,
) {
	const retryOriginal = form.validate("review").find((issue) => issue.code === "hidden");
	if (!retryOriginal) throw Error("missing recertified draft issue");
	expect(originalIssueSource(retryOriginal)).toBeDefined();
	publishIssueOnly(store, [retryOriginal]);
	expect(originalIssueSource(retryOriginal)).toBeDefined();
	seen.length = 0;
	const success = await form.submit(context);
	expect(success.ok).toBe(true);
	expect(form.getState().attemptValidation?.submitId).not.toBe(previousId);
	expect(handler).toHaveBeenCalledTimes(1);
	const payload = handler.mock.calls[0]?.[0]?.payload;
	expect(payload).toEqual({ pinned: "keep", name: "Grace" });
	expect(Object.isFrozen(payload)).toBe(true);
	expect(seen.map((input) => input.kind).sort()).toEqual(["caller-async", "core", "prepared", "scoped-async"]);
	for (const input of seen) {
		expect(input.data).toBe(payload);
		expect(input.uiState).toEqual({ tab: "review" });
		expect(input.stage).toBe("review");
		expect(input.context).toMatchObject(context);
	}
	expect(form.getState().data).toBe(draft);
	expect(form.getState().data).toEqual({ secret: "draft", pinned: "keep", name: "Grace" });
	expect(form.getState().issues).toContain(retryOriginal);
	expect(form.getState().meta.submission?.status).toBe("succeeded");
	expect(Object.keys(form.getState()).sort()).toEqual([
		"attemptValidation",
		"data",
		"fieldMeta",
		"fieldPolicy",
		"issues",
		"meta",
		"uiState",
	]);
}

test("#233 bound handler retains certified draft while blockers and last-publication writes fail closed", async () => {
	const f = fixture();
	stageReview(f);
	const firstId = await rejectIndependentBlockers(f);
	if (!firstId) throw Error("missing first attempt submitId");
	const { draft, submitId } = await supersedeBlockedAttempt(f, firstId);
	if (!submitId) throw Error("missing second attempt submitId");
	await retryChecked(f, draft, submitId);
	f.form.dispose();
});
