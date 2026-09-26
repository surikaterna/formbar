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

async function rejectLastPublication({ form, handler }: ReturnType<typeof fixture>) {
	expect(form.validate("review").some((issue) => issue.code === "hidden")).toBe(true);
	let wrote = false;
	const stop = form.subscribe((state) => {
		if (state.attemptValidation?.status !== "succeeded" || state.meta.validation.validating || wrote) return;
		wrote = true;
		form.setValue("name", "Grace");
	});
	const stale = await form.submit(context);
	expect(wrote).toBe(true);
	expect(stale.ok).toBe(false);
	expect(handler).not.toHaveBeenCalled();
	stop();
	expect(form.getState().data.secret).toBe("draft");
}

async function rejectIndependentBlockers({ form, store, handler }: ReturnType<typeof fixture>) {
	const stageTx = store.beginTransaction();
	stageTx.mutate((state) => ({ ...state, meta: { ...state.meta, stage: "review" } }));
	store.commitTransaction(stageTx);

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
	const blocked = await form.submit(context);
	expect(blocked).toMatchObject({ ok: false, reason: "validation-failed" });
	expect(blocked.fieldIssues).toEqual(expect.arrayContaining([unowned, root]));
	expect(blocked.fieldIssues).toHaveLength(2);
	expect(blocked.fieldIssues).not.toContain(original);
	expect(form.getState().attemptValidation?.status).toBe("failed");
	expect(renderableIssues(form.getState())).toEqual(expect.arrayContaining([original, unowned, root]));
	expect(form.getState().issues).toContain(original);
	expect(handler).not.toHaveBeenCalled();
	return form.getState().data;
}

async function retryChecked({ form, store, handler, seen }: ReturnType<typeof fixture>, draft: unknown) {
	const retryOriginal = form.validate("review").find((issue) => issue.code === "hidden");
	if (!retryOriginal) throw Error("missing recertified draft issue");
	expect(originalIssueSource(retryOriginal)).toBeDefined();
	publishIssueOnly(store, [retryOriginal]);
	expect(originalIssueSource(retryOriginal)).toBeDefined();
	seen.length = 0;
	const success = await form.submit(context);
	expect(success.ok).toBe(true);
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
	await rejectLastPublication(f);
	const draft = await rejectIndependentBlockers(f);
	await retryChecked(f, draft);
	f.form.dispose();
});
