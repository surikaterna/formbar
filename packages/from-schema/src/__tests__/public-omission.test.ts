import { createForm } from "@formbar/core";
import { boundSubmitStore } from "@formbar/core/internal/submit-proof";
import { describe, expect, it, vi } from "vitest";
import { publishIssueOnly } from "../../../core/src/store.js";
import { createSchemaForm, jsonSchemaProvider } from "../index.js";

const provider = jsonSchemaProvider();
const visible = { kind: "ref" as const, ref: { namespace: "data" as const, segments: ["show"] } };
const definition = (mode?: "include" | "omit-inactive", override = false) => ({
	version: 1 as const,
	id: "public-omission",
	...(mode ? { submission: { hiddenValues: mode } } : {}),
	root: {
		type: "group" as const,
		id: "root",
		children: [
			{
				type: "field" as const,
				id: "secret",
				widget: "text",
				binding: { namespace: "data" as const, segments: ["secret"] },
				visible,
				...(override ? { submitWhenHidden: "include" as const } : {}),
			},
			{
				type: "field" as const,
				id: "name",
				widget: "text",
				binding: { namespace: "data" as const, segments: ["name"] },
			},
		],
	},
});

describe("#226 public definition-bound submission", () => {
	it("validates final request, retains hidden draft through hide/show/retry/reset", async () => {
		const seen: unknown[] = [];
		const handler = vi.fn(async () => ({ ok: true as const }));
		const prepared = createSchemaForm({}, { provider, side: "input", definition: definition("omit-inactive") });
		const form = prepared.createForm({
			initialData: { secret: "draft", show: false, name: "Ada" },
			validators: [
				({ data }) => {
					seen.push(data);
					return [];
				},
			],
			asyncValidators: [
				{
					id: "final",
					validate: async ({ data }) => {
						seen.push(data);
						return [];
					},
				},
			],
			onSubmit: handler,
		});
		expect(await form.submit()).toMatchObject({ ok: true });
		const hiddenPayload = handler.mock.calls[0]?.[0].payload;
		expect(hiddenPayload).toEqual({ show: false, name: "Ada" });
		expect(Object.isFrozen(hiddenPayload)).toBe(true);
		expect(seen).toContain(hiddenPayload);
		expect(form.getState().data.secret).toBe("draft");
		form.setValue("show", true);
		expect(await form.submit()).toMatchObject({ ok: true });
		expect(handler.mock.calls[1]?.[0].payload).toEqual({ secret: "draft", show: true, name: "Ada" });
		form.setValue("secret", "changed");
		form.setValue("show", false);
		expect(await form.submit()).toMatchObject({ ok: true });
		form.reset();
		expect(form.getState().data.secret).toBe("draft");
		expect(await form.submit()).toMatchObject({ ok: true });
		expect(handler.mock.calls[3]?.[0].payload).toEqual(hiddenPayload);
		form.dispose();
	});

	it("includes hidden override and preserves default and naked full-draft submission", async () => {
		const handler = vi.fn(async () => ({ ok: true as const }));
		const data = { secret: "draft", show: false, name: "Ada" };
		for (const authored of [definition("omit-inactive", true), definition(), definition("include")]) {
			const form = createSchemaForm({}, { provider, side: "input", definition: authored }).createForm({
				initialData: data,
				onSubmit: handler,
			});
			expect(await form.submit()).toMatchObject({ ok: true });
			expect(handler.mock.lastCall?.[0].payload).toEqual(data);
			form.dispose();
		}
		const naked = createForm({ initialData: data, onSubmit: handler });
		expect(await naked.submit()).toMatchObject({ ok: true });
		expect(handler.mock.lastCall?.[0].payload).toEqual(data);
		naked.dispose();
	});

	it("rejects required omitted values with Ajv on final bytes", async () => {
		const schema = { type: "object", required: ["secret"], properties: { secret: { type: "string" } } };
		const prepared = createSchemaForm(schema, { provider, side: "input", definition: definition("omit-inactive") });
		const handler = vi.fn();
		const form = prepared.createForm({ initialData: { secret: "draft", show: false, name: "Ada" }, onSubmit: handler });
		expect(await form.submit()).toMatchObject({ ok: false, reason: "validation-failed" });
		expect(handler).not.toHaveBeenCalled();
		form.dispose();
	});

	it("applies if/then required to final bytes and permits only safe included egress edits", async () => {
		const schema = {
			type: "object",
			properties: { show: { type: "boolean" }, secret: { type: "string" }, name: { type: "string" } },
			if: { properties: { show: { const: false } }, required: ["show"] },
			then: { required: ["secret"] },
		};
		const prepared = createSchemaForm(schema, { provider, side: "input", definition: definition("omit-inactive") });
		const handler = vi.fn(async () => ({ ok: true as const }));
		const form = prepared.createForm({
			initialData: { show: false, secret: "retained", name: "Ada", extra: "before" },
			transforms: [{ id: "safe", phase: "egress", transform: (data) => ({ ...data, extra: "after" }) }],
			onSubmit: handler,
		});
		expect(await form.submit()).toMatchObject({ ok: false, reason: "validation-failed" });
		expect(handler).not.toHaveBeenCalled();
		expect(form.getState().data.secret).toBe("retained");
		form.setValue("show", true);
		expect(await form.submit()).toMatchObject({ ok: true });
		expect(handler.mock.calls[0]?.[0].payload).toEqual({ show: true, secret: "retained", name: "Ada", extra: "after" });
		expect(form.getState().data.extra).toBe("before");
		form.dispose();
	});

	it("rejects egress reintroduction without calling the handler", async () => {
		const handler = vi.fn();
		const form = createSchemaForm({}, { provider, side: "input", definition: definition("omit-inactive") }).createForm({
			initialData: { show: false, secret: "retained", name: "Ada" },
			transforms: [{ id: "restore", phase: "egress", transform: (data) => ({ ...data, secret: "retained" }) }],
			onSubmit: handler,
		});
		expect(await form.submit()).toMatchObject({ ok: false });
		expect(handler).not.toHaveBeenCalled();
		expect(form.getState().data.secret).toBe("retained");
		form.dispose();
	});

	it("exempts only an original certified hidden error, never an unowned same-path error", async () => {
		const handler = vi.fn(async () => ({ ok: true as const }));
		const prepared = createSchemaForm(
			{},
			{
				provider,
				side: "input",
				definition: definition("omit-inactive"),
				fieldValidators: [
					{
						fieldId: "secret",
						validate: ({ data }) =>
							data && typeof data === "object" && "secret" in data
								? [{ code: "hidden", message: "bad", severity: "error" }]
								: [],
					},
				],
			},
		);
		const form = prepared.createForm({ initialData: { show: false, secret: "draft", name: "Ada" }, onSubmit: handler });
		const original = form.validate().find((issue) => issue.code === "hidden");
		if (!original) throw Error("Missing certified hidden issue");
		const store = boundSubmitStore(form);
		if (!store) throw Error("Missing bound store");
		publishIssueOnly(store, [original]);
		expect(form.getState().issues.map((issue) => issue.code)).toContain("hidden");
		expect(await form.submit()).toMatchObject({ ok: true });
		expect(handler.mock.calls[0]?.[0].payload).toEqual({ show: false, name: "Ada" });
		publishIssueOnly(store, [{ ...original, code: "unowned", path: { ...original.path, segments: ["secret"] } }]);
		expect(await form.submit()).toMatchObject({ ok: false });
		expect(handler).toHaveBeenCalledTimes(1);
		form.dispose();
	});

	it("sends only inactive cells from nested typed-key rows while preserving included cells and row shape", async () => {
		const field = (id: string, key: string, override = false) => ({
			type: "field" as const,
			id,
			widget: "text",
			binding: { namespace: "data" as const, scope: "inner", segments: [key] },
			...(id !== "id" ? { visible: { kind: "literal" as const, value: false } } : {}),
			...(override ? { submitWhenHidden: "include" as const } : {}),
		});
		const definition = {
			version: 1 as const,
			id: "nested",
			submission: { hiddenValues: "omit-inactive" as const },
			root: {
				type: "repeater" as const,
				id: "outer",
				scope: "outer",
				binding: { namespace: "data" as const, segments: ["a.b"] },
				children: [
					{
						type: "repeater" as const,
						id: "inner-repeater",
						scope: "inner",
						binding: { namespace: "data" as const, scope: "outer", segments: ["0"] },
						children: [field("secret", "deep.key"), field("id", "id"), field("override", "override", true)],
					},
				],
			},
		};
		const draft = { "a.b": [{ id: "outer-1", "0": [{ id: "a", "deep.key": 1, override: "A" }] }] };
		const onSubmit = vi.fn(async () => ({ ok: true as const }));
		const form = createSchemaForm({}, { provider, side: "input", definition }).createForm({
			initialData: draft,
			onSubmit,
		});
		expect(await form.submit()).toMatchObject({ ok: true });
		expect(onSubmit.mock.calls[0]?.[0].payload).toEqual({
			"a.b": [{ id: "outer-1", "0": [{ id: "a", override: "A" }] }],
		});
		expect(form.getState().data).toEqual(draft);
		form.dispose();
	});

	it("honors Arbiter visible:false before checked submit without changing the draft", async () => {
		const onSubmit = vi.fn(async () => ({ ok: true as const }));
		const form = createSchemaForm({}, { provider, side: "input", definition: definition("omit-inactive") }).createForm({
			initialData: { show: true, secret: "draft", name: "Ada" },
			plugins: [{ id: "policy", evaluate: () => ({ fieldPolicy: [{ path: "secret", visible: false }] }) }],
			onSubmit,
		});
		form.setValue("name", "Grace");
		expect(await form.submit()).toMatchObject({ ok: true });
		expect(onSubmit.mock.calls[0]?.[0].payload).toEqual({ show: true, name: "Grace" });
		expect(form.getState().data.secret).toBe("draft");
		form.dispose();
	});

	it("forwards generated mode and stable field-ID include overrides; rejects conflicts and unknown IDs", async () => {
		const schema = { type: "object", properties: { secret: { type: "string" } } };
		const submission = { hiddenValues: "omit-inactive" as const };
		const generated = createSchemaForm(schema, { provider, side: "input", submission });
		expect(generated.definition.submission).toEqual(submission);
		const handler = vi.fn(async () => ({ ok: true as const }));
		const form = generated.createForm({ initialData: { secret: "draft" }, onSubmit: handler });
		expect(await form.submit()).toMatchObject({ ok: true });
		expect(handler.mock.calls[0]?.[0].payload).toEqual({ secret: "draft" });
		form.dispose();
		const id = generated.baseline[0]?.nodeId;
		expect(id).toBeTruthy();
		const overridden = createSchemaForm(schema, {
			provider,
			side: "input",
			submission,
			generation: { submitWhenHidden: { [id as string]: "include" } },
		});
		expect(JSON.stringify(overridden.definition.root)).toContain('"submitWhenHidden":"include"');
		expect(() =>
			createSchemaForm(schema, {
				provider,
				side: "input",
				generation: { submitWhenHidden: { unknown: "include" } },
			}),
		).toThrow(/field ID/);
		expect(() =>
			createSchemaForm(schema, {
				provider,
				side: "input",
				generation: { submitWhenHidden: { [generated.definition.root.id]: "include" } },
			}),
		).toThrow(/field ID/);
		expect(() =>
			createSchemaForm(schema, {
				provider,
				side: "input",
				generation: { submitWhenHidden: { [id as string]: "omit" as never } },
			}),
		).toThrow(/field ID/);
		expect(() =>
			createSchemaForm(
				{},
				{
					provider,
					side: "input",
					definition: definition("omit-inactive"),
					submission: { hiddenValues: "include" },
				},
			),
		).toThrow(/conflict/);
		expect(() =>
			createSchemaForm(
				{},
				{
					provider,
					side: "input",
					definition: definition(),
					submission,
				},
			),
		).toThrow(/conflict/);
	});
});
