import { activateBoundSubmit, boundSubmitStore, boundSubmitSupplier } from "@formbar/core/internal/submit-proof";
import { describe, expect, it, vi } from "vitest";
import { createSchemaForm, jsonSchemaProvider } from "../index.js";

const definition = {
	version: 1 as const,
	id: "checked-handler",
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
				visible: { kind: "ref" as const, ref: { namespace: "data" as const, segments: ["show"] } },
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

function setup(extra: Record<string, unknown> = {}, schema: object = {}) {
	const prepared = createSchemaForm(schema, {
		provider: jsonSchemaProvider(),
		side: "input",
		definition,
	});
	const handler = vi.fn(async (_input: { payload: unknown; form: unknown }) => ({ ok: true as const }));
	const form = prepared.createForm({
		initialData: { secret: "draft", show: false, name: "Ada" },
		onSubmit: handler,
		...extra,
	});
	expect([!!boundSubmitStore(form), !!boundSubmitSupplier(form)]).toEqual([true, true]);
	activateBoundSubmit(form);
	return { form, handler, prepared };
}

describe("#249 private bound checked handler", () => {
	it("hands the handler the exact checked FINAL object and coherent captured UI; show/reset restores draft", async () => {
		const seen: unknown[] = [];
		const { form, handler } = setup({
			initialUiState: { tab: "first" },
			validators: [
				({ data, uiState }: { data: unknown; uiState: unknown }) => {
					seen.push([data, uiState]);
					return [];
				},
			],
			asyncValidators: [
				{
					id: "capture",
					validate: async ({ data, uiState }: { data: unknown; uiState: unknown }) => {
						seen.push([data, uiState]);
						return [];
					},
				},
			],
		});
		const result = await form.submit();
		expect(result.ok).toBe(true);
		expect(handler).toHaveBeenCalledTimes(1);
		const payload = handler.mock.calls[0]?.[0].payload;
		expect(payload).toEqual({ show: false, name: "Ada" });
		expect(Object.isFrozen(payload)).toBe(true);
		expect(seen.length).toBeGreaterThanOrEqual(2);
		for (const [data, uiState] of seen as [unknown, unknown][]) {
			expect(data).toBe(payload);
			expect(uiState).toEqual({ tab: "first" });
		}
		expect(form.getState().data.secret).toBe("draft");
		form.setValue("show", true);
		expect((await form.submit()).ok).toBe(true);
		expect(handler).toHaveBeenCalledTimes(2);
		expect(handler.mock.calls[1]?.[0].payload).toEqual({ secret: "draft", show: true, name: "Ada" });
		form.reset();
		expect(form.getState().data.secret).toBe("draft");
		form.dispose();
	});

	it("fails closed on validator errors, egress reintroduction and abort without calling handler", async () => {
		const invalid = setup({
			validators: [
				() => [
					{
						code: "invalid",
						message: "invalid",
						severity: "error",
						path: { namespace: "data", segments: ["name"] },
						source: { origin: "function-validator", validatorId: "invalid" },
					},
				],
			],
		});
		expect(await invalid.form.submit()).toMatchObject({ ok: false, reason: "validation-failed" });
		expect(invalid.handler).not.toHaveBeenCalled();
		invalid.form.dispose();
		const reintroduced = setup({
			transforms: [{ id: "leak", phase: "egress", transform: () => ({ secret: "leak", name: "Ada", show: false }) }],
		});
		expect((await reintroduced.form.submit()).ok).toBe(false);
		expect(reintroduced.handler).not.toHaveBeenCalled();
		reintroduced.form.dispose();
		const aborted = setup();
		const controller = new AbortController();
		controller.abort();
		expect((await aborted.form.submit(undefined, controller.signal)).ok).toBe(false);
		expect(aborted.handler).not.toHaveBeenCalled();
		aborted.form.dispose();
	});

	it("recaptures on retry and refuses handler after reset, mutation, or concurrent submit", async () => {
		let release!: (issues: []) => void;
		const waiting = new Promise<[]>((resolve) => {
			release = resolve;
		});
		const { form, handler } = setup({
			asyncValidators: [{ id: "pause", validate: () => waiting }],
		});
		const pending = form.submit();
		await expect(form.submit()).rejects.toThrow("already in progress");
		form.reset();
		release([]);
		expect((await pending).ok).toBe(false);
		expect(handler).not.toHaveBeenCalled();
		expect((await form.submit()).ok).toBe(true);
		expect(handler).toHaveBeenCalledTimes(1);
		form.dispose();
	});

	it.each(["dispose", "reset", "abort", "timeout"] as const)(
		"settles a pending owned FINAL after %s without publishing a late result",
		async (lifecycle) => {
			let release!: (issues: []) => void;
			const waiting = new Promise<[]>((resolve) => {
				release = resolve;
			});
			const controller = new AbortController();
			const { form, handler } = setup({
				asyncValidators: [{ id: "pending", validate: () => waiting }],
				...(lifecycle === "timeout" ? { timeouts: { validator: 5 } } : {}),
			});
			const pending = form.submit(undefined, controller.signal);
			expect(form.getState().meta.validation.validating).toBe(true);
			if (lifecycle === "dispose") form.dispose();
			if (lifecycle === "reset") form.reset();
			if (lifecycle === "abort") controller.abort();
			if (lifecycle === "timeout") await new Promise((resolve) => setTimeout(resolve, 20));
			const state = form.getState();
			expect(state.meta.validation.validating).toBe(false);
			release([]);
			await expect(pending).resolves.toMatchObject({ ok: false });
			if (lifecycle !== "abort") expect(form.getState()).toBe(state);
			expect(form.getState().data.secret).toBe("draft");
			expect(handler).not.toHaveBeenCalled();
			form.dispose();
		},
	);

	it("does not publish a late candidate after deferred host deactivation", async () => {
		let release!: (issues: []) => void;
		const waiting = new Promise<[]>((resolve) => {
			release = resolve;
		});
		const prepared = createSchemaForm({}, { provider: jsonSchemaProvider(), side: "input", definition });
		const handler = vi.fn(async () => ({ ok: true as const }));
		const deferred = prepared.createDeferredForm({
			initialData: { secret: "draft", show: false, name: "Ada" },
			asyncValidators: [{ id: "pending", validate: () => waiting }],
			onSubmit: handler,
		});
		deferred.activate();
		const pending = deferred.form.submit();
		deferred.deactivate();
		const state = deferred.form.getState();
		release([]);
		await expect(pending).resolves.toMatchObject({ ok: false });
		expect(deferred.form.getState()).toBe(state);
		expect(handler).not.toHaveBeenCalled();
		deferred.form.dispose();
	});

	it("returns an aborted result after disposal even without async validators or a handler", async () => {
		const { form } = setup({
			onSubmit: undefined,
			middleware: [{ id: "dispose", afterValidate: () => form.dispose() }],
		});
		await expect(form.submit()).resolves.toMatchObject({ ok: false });
		expect(form.getState().data.secret).toBe("draft");
	});

	it("does not mistake an unsupported live owned publication for disposal", async () => {
		let release!: (issues: []) => void;
		const waiting = new Promise<[]>((resolve) => {
			release = resolve;
		});
		const { form, handler } = setup({ asyncValidators: [{ id: "pending", validate: () => waiting }] });
		const pending = form.submit();
		const store = boundSubmitStore(form);
		if (!store) throw new Error("missing bound store");
		const tx = store.beginTransaction();
		try {
			release([]);
			await expect(pending).rejects.toThrow("OWNED_STATE_UNSUPPORTED");
			expect(handler).not.toHaveBeenCalled();
		} finally {
			store.rollbackTransaction(tx);
			form.dispose();
		}
	});

	it("blocks reentrant semantic writes even with zero asynchronous validators", async () => {
		const reference: { form?: ReturnType<typeof setup>["form"] } = {};
		const handler = vi.fn();
		const fixture = setup({
			validators: [
				() => {
					reference.form?.setValue("name", "Grace");
					return [];
				},
			],
			onSubmit: handler,
		});
		const form = fixture.form;
		reference.form = form;
		expect((await form.submit()).ok).toBe(false);
		expect(handler).not.toHaveBeenCalled();
		form.dispose();
	});

	it("keeps failed attempt issues visible, retries with fresh bytes and preserves success metadata", async () => {
		let reject = true;
		const after = vi.fn();
		const retryIssue = {
			code: "retry",
			message: "retry",
			severity: "error",
			path: { namespace: "data", segments: ["name"] },
			source: { origin: "function-validator", validatorId: "retry" },
		};
		const { form, handler } = setup({
			validators: [() => (reject ? [retryIssue] : [])],
			middleware: [{ id: "after", afterSubmit: after }],
		});
		const failure = await form.submit();
		expect(failure).toMatchObject({ ok: false, reason: "validation-failed" });
		expect(failure.fieldIssues?.[0]?.code).toBe("retry");
		const fieldIssues = form.field("name").issues();
		expect(fieldIssues.some((issue) => issue.code === "retry")).toBe(true);
		expect(handler).not.toHaveBeenCalled();
		reject = false;
		expect((await form.submit()).ok).toBe(true);
		expect(handler).toHaveBeenCalledTimes(1);
		expect(form.getState().meta.submission?.status).toBe("succeeded");
		expect(after).toHaveBeenCalledTimes(1);
		form.dispose();
	});

	it("validates and completes metadata without invoking a missing onSubmit callback", async () => {
		const { form, handler } = setup({ onSubmit: undefined });
		expect((await form.submit()).ok).toBe(true);
		expect(form.getState().meta.submission?.status).toBe("succeeded");
		expect(handler).not.toHaveBeenCalled();
		form.dispose();
	});

	it("does not invoke the handler after a plugin veto", async () => {
		const { form, handler } = setup({
			plugins: [
				{
					id: "reject",
					beforeSubmit: () => [
						{
							code: "blocked",
							message: "blocked",
							severity: "error",
							path: { namespace: "data", segments: [] },
							source: { origin: "rule", validatorId: "reject" },
						},
					],
				},
			],
		});
		expect((await form.submit()).ok).toBe(false);
		expect(handler).not.toHaveBeenCalled();
		form.dispose();
	});

	it("does not submit a deferred definition while inactive or after deactivation", async () => {
		const prepared = createSchemaForm({}, { provider: jsonSchemaProvider(), side: "input", definition });
		const handler = vi.fn(async () => ({ ok: true as const }));
		const deferred = prepared.createDeferredForm({
			initialData: { secret: "draft", show: false, name: "Ada" },
			onSubmit: handler,
		});
		activateBoundSubmit(deferred.form);
		expect((await deferred.form.submit()).ok).toBe(false);
		deferred.activate();
		expect((await deferred.form.submit()).ok).toBe(true);
		deferred.deactivate();
		expect((await deferred.form.submit()).ok).toBe(false);
		expect(handler).toHaveBeenCalledTimes(1);
		deferred.form.dispose();
	});

	it("rejects a semantic write reentrant from the running notification", async () => {
		const { form, handler } = setup();
		const stop = form.subscribe((state) => {
			if (state.meta.submission?.status === "running" && state.data.name === "Ada") form.setValue("name", "Grace");
		});
		expect((await form.submit()).ok).toBe(false);
		expect(handler).not.toHaveBeenCalled();
		stop();
		form.dispose();
	});

	it("never calls a handler after async validator timeout", async () => {
		const { form, handler } = setup({
			asyncValidators: [{ id: "slow", validate: () => new Promise(() => {}) }],
			timeouts: { validator: 5 },
		});
		expect((await form.submit()).ok).toBe(false);
		expect(handler).not.toHaveBeenCalled();
		form.dispose();
	});

	it("runs prepared Ajv if/then required against omitted FINAL data before the handler", async () => {
		const schema = {
			type: "object",
			properties: { show: { type: "boolean" }, secret: { type: "string" } },
			if: { properties: { show: { const: false } } },
			then: { required: ["secret"] },
		};
		const { form, handler } = setup({}, schema);
		const result = await form.submit();
		expect(result).toMatchObject({ ok: false, reason: "validation-failed" });
		expect(result.fieldIssues?.length).toBeGreaterThan(0);
		expect(handler).not.toHaveBeenCalled();
		expect(form.getState().data.secret).toBe("draft");
		form.dispose();
	});
});
