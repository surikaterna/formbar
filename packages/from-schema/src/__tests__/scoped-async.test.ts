import { describe, expect, it, vi } from "vitest";
import type { DefinitionAsyncFieldValidator } from "../index.js";
import { createSchemaForm, jsonSchemaProvider } from "../index.js";

const definition = {
	version: 1 as const,
	id: "nested-async",
	root: {
		type: "group" as const,
		id: "root",
		children: [
			{
				type: "repeater" as const,
				id: "outer",
				scope: "o",
				binding: { namespace: "data", segments: ["a.b"] },
				children: [
					{
						type: "repeater" as const,
						id: "inner",
						scope: "i",
						binding: { namespace: "data", scope: "o", segments: ["0"] },
						children: [
							{
								type: "field" as const,
								id: "leaf",
								widget: "text",
								binding: { namespace: "data", scope: "i", segments: ["deep.key"] },
							},
						],
					},
				],
			},
		],
	},
};

const flatDefinition = {
	version: 1 as const,
	id: "flat-async",
	root: {
		type: "field" as const,
		id: "name-field",
		widget: "text",
		binding: { namespace: "data", segments: ["name"] },
	},
};

function deferredNestedValidator(validate: DefinitionAsyncFieldValidator<unknown, unknown>["validate"]) {
	return createSchemaForm(
		{},
		{
			provider: jsonSchemaProvider(),
			side: "input",
			definition,
			asyncFieldValidators: [{ id: "independent", fieldId: "leaf", debounceMs: 0, validate }],
		},
	);
}

const legacyAsyncValidator = {
	id: "legacy",
	validate: async () => [
		{
			code: "legacy",
			message: "bad",
			severity: "error" as const,
			path: { namespace: "data" as const, segments: ["a.b"] },
			source: { origin: "async-validator" as const, validatorId: "legacy" },
		},
	],
};

describe("definition-scoped asynchronous validation", () => {
	it("bounds ignored automatic signals with a blocking timeout diagnostic", async () => {
		vi.useFakeTimers();
		try {
			let signal: AbortSignal | undefined;
			const prepared = createSchemaForm(
				{},
				{
					provider: jsonSchemaProvider(),
					side: "input",
					definition: flatDefinition,
					asyncFieldValidators: [
						{
							id: "slow",
							fieldId: "name-field",
							debounceMs: 0,
							validate: ({ signal: current }) => {
								signal = current;
								return new Promise(() => {});
							},
						},
					],
				},
			);
			const form = prepared.createForm({ initialData: { name: "Ada" }, timeouts: { validator: 5 } });
			form.setValue("name", "Grace");
			await vi.advanceTimersByTimeAsync(5);
			expect(form.getState().issues).toMatchObject([
				{ code: "ASYNC_VALIDATOR_EXCEPTION", source: { validatorId: "slow" } },
			]);
			expect(signal?.aborted).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it("keeps blur-triggered work separate from change-triggered work", async () => {
		vi.useFakeTimers();
		try {
			const observed: string[] = [];
			const prepared = createSchemaForm(
				{},
				{
					provider: jsonSchemaProvider(),
					side: "input",
					definition: flatDefinition,
					asyncFieldValidators: [
						{
							id: "change",
							fieldId: "name-field",
							debounceMs: 5,
							validate: async () => {
								observed.push("change");
								return [{ code: "change", message: "bad", severity: "error" }];
							},
						},
						{
							id: "blur",
							fieldId: "name-field",
							trigger: "onBlur",
							debounceMs: 10,
							validate: async () => {
								observed.push("blur");
								return [{ code: "blur", message: "bad", severity: "error" }];
							},
						},
					],
				},
			);
			const form = prepared.createForm({ initialData: { name: "Ada" } });
			form.setValue("name", "Grace");
			form.field("name").markTouched();
			await vi.advanceTimersByTimeAsync(5);
			expect(observed).toEqual(["change"]);
			await vi.advanceTimersByTimeAsync(5);
			expect(observed).toEqual(["change", "blur"]);
			expect(form.getState().issues.map((issue) => issue.code)).toEqual(["blur", "change"]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not complete or publish partial foreground results on timeout", async () => {
		vi.useFakeTimers();
		try {
			const hanging = createSchemaForm(
				{},
				{
					provider: jsonSchemaProvider(),
					side: "input",
					definition: flatDefinition,
					asyncFieldValidators: [{ id: "hang", fieldId: "name-field", validate: () => new Promise(() => {}) }],
				},
			).createForm({
				initialData: { name: "Ada" },
				timeouts: { validator: 5 },
				asyncValidators: [
					{
						id: "legacy",
						validate: async () => [
							{
								code: "legacy",
								message: "bad",
								severity: "error",
								path: { namespace: "data", segments: ["name"] },
								source: { origin: "async-validator", validatorId: "legacy" },
							},
						],
					},
				],
			});
			const pending = hanging.validateAsync();
			await vi.advanceTimersByTimeAsync(5);
			expect((await pending).status).toBe("aborted");
			expect(hanging.getState().issues).toEqual([]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("rejects malformed scoped diagnostics without publishing them", async () => {
		const malformed = createSchemaForm(
			{},
			{
				provider: jsonSchemaProvider(),
				side: "input",
				definition: flatDefinition,
				asyncFieldValidators: [
					{
						id: "bad",
						fieldId: "name-field",
						validate: async () => [{ code: "bad", message: "bad", severity: "error", descendant: ["outside"] }],
					},
				],
			},
		).createForm({ initialData: { name: "Ada" } });
		expect((await malformed.validateAsync()).status).toBe("aborted");
		expect(malformed.getState().issues).toEqual([]);
	});

	it("discards late scoped foreground completions after reset and disposal", async () => {
		const resolvers: ((issues: readonly { code: string; message: string; severity: "error" }[]) => void)[] = [];
		const prepared = createSchemaForm(
			{},
			{
				provider: jsonSchemaProvider(),
				side: "input",
				definition: flatDefinition,
				asyncFieldValidators: [
					{
						id: "late",
						fieldId: "name-field",
						validate: () =>
							new Promise((resolve) => {
								resolvers.push(resolve);
							}),
					},
				],
			},
		);
		const form = prepared.createForm({ initialData: { name: "Ada" } });
		const resetRun = form.validateAsync();
		form.reset();
		expect((await resetRun).status).toBe("aborted");
		resolvers[0]?.([{ code: "stale", message: "bad", severity: "error" }]);
		await Promise.resolve();
		expect(form.getState().issues).toEqual([]);
		const disposeRun = form.validateAsync();
		form.dispose();
		expect((await disposeRun).status).toBe("aborted");
		resolvers[1]?.([{ code: "stale", message: "bad", severity: "error" }]);
		await Promise.resolve();
		expect(form.getState().issues).toEqual([]);
	});

	it("does not return completed success after a subscriber mutates during publication", async () => {
		const prepared = createSchemaForm(
			{},
			{
				provider: jsonSchemaProvider(),
				side: "input",
				definition: flatDefinition,
				asyncFieldValidators: [
					{
						id: "reentrant",
						fieldId: "name-field",
						validate: async () => [{ code: "invalid", message: "bad", severity: "error" }],
					},
				],
			},
		);
		const form = prepared.createForm({ initialData: { name: "Ada" } });
		let changed = false;
		const unsubscribe = form.subscribe((state) => {
			if (!changed && state.issues.length) {
				changed = true;
				form.setValue("name", "Grace");
			}
		});
		expect((await form.validateAsync()).status).toBe("superseded");
		expect(changed).toBe(true);
		unsubscribe();
		form.dispose();
	});
	it("schedules two concrete rows after a parent change without dropping either result", async () => {
		vi.useFakeTimers();
		try {
			const prepared = createSchemaForm(
				{},
				{
					provider: jsonSchemaProvider(),
					side: "input",
					definition,
					asyncFieldValidators: [
						{
							id: "two-rows",
							fieldId: "leaf",
							validate: async () => [{ code: "automatic", message: "bad", severity: "error" }],
						},
					],
				},
			);
			const data = { "a.b": [{ "0": [{ "deep.key": "x" }, { "deep.key": "y" }] }] };
			const form = prepared.createForm({ initialData: data });
			expect(form.setValue("/a.b", [{ "0": [{ "deep.key": "a" }, { "deep.key": "b" }] }]).ok).toBe(true);
			await vi.advanceTimersByTimeAsync(300);
			expect(form.getState().issues.map((issue) => issue.path.segments)).toEqual([
				["a.b", 0, "0", 0, "deep.key"],
				["a.b", 0, "0", 1, "deep.key"],
			]);
			form.setValue("/a.b", [{ "0": [{ "deep.key": "c" }, { "deep.key": "d" }] }]);
			await vi.advanceTimersByTimeAsync(300);
			expect(form.getState().issues).toHaveLength(2);
			form.setValue("/a.b", []);
			expect(form.getState().issues).toEqual([]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("cancels old row work on reorder and reset without publishing stale issues", async () => {
		vi.useFakeTimers();
		try {
			const observed: unknown[] = [];
			const prepared = createSchemaForm(
				{},
				{
					provider: jsonSchemaProvider(),
					side: "input",
					definition,
					asyncFieldValidators: [
						{
							id: "reorder",
							fieldId: "leaf",
							validate: async ({ field }) => {
								observed.push(field.binding.segments);
								return [{ code: "current", message: "current", severity: "error" }];
							},
						},
					],
				},
			);
			const form = prepared.createForm({
				initialData: { "a.b": [{ "0": [{ "deep.key": "a" }, { "deep.key": "b" }] }] },
			});
			form.setValue("/a.b", [{ "0": [{ "deep.key": "b" }, { "deep.key": "a" }] }]);
			form.setValue("/a.b", [{ "0": [{ "deep.key": "a" }, { "deep.key": "b" }] }]);
			await vi.advanceTimersByTimeAsync(300);
			expect(observed).toHaveLength(2);
			expect(form.getState().issues).toHaveLength(2);
			form.setValue("/a.b", [{ "0": [{ "deep.key": "changed" }] }]);
			form.reset({ data: { "a.b": [] } });
			await vi.advanceTimersByTimeAsync(300);
			expect(observed).toHaveLength(2);
			expect(form.getState().issues).toEqual([]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("publishes one resolved row without waiting for the other row", async () => {
		vi.useFakeTimers();
		try {
			const resolve: ((value: readonly { code: string; message: string; severity: "error" }[]) => void)[] = [];
			const prepared = deferredNestedValidator(
				() =>
					new Promise((done) => {
						resolve.push(done);
					}),
			);
			const form = prepared.createForm({
				initialData: { "a.b": [{ "0": [{ "deep.key": "x" }, { "deep.key": "y" }] }] },
			});
			form.setValue("/a.b", [{ "0": [{ "deep.key": "a" }, { "deep.key": "b" }] }]);
			await vi.advanceTimersByTimeAsync(0);
			expect(resolve).toHaveLength(2);
			resolve[1]?.([{ code: "second", message: "bad", severity: "error" }]);
			await vi.advanceTimersByTimeAsync(0);
			expect(form.getState().issues.map((issue) => issue.code)).toEqual(["second"]);
			resolve[0]?.([{ code: "first", message: "bad", severity: "error" }]);
			await vi.advanceTimersByTimeAsync(0);
			expect(form.getState().issues.map((issue) => issue.code)).toEqual(["first", "second"]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("ignores old in-flight results after concrete index reuse", async () => {
		vi.useFakeTimers();
		try {
			const resolve: ((issues: readonly { code: string; message: string; severity: "error" }[]) => void)[] = [];
			const prepared = deferredNestedValidator(
				() =>
					new Promise((done) => {
						resolve.push(done);
					}),
			);
			const form = prepared.createForm({
				initialData: { "a.b": [{ "0": [{ "deep.key": "x" }, { "deep.key": "y" }] }] },
			});
			form.setValue("/a.b", [{ "0": [{ "deep.key": "a" }, { "deep.key": "b" }] }]);
			await vi.advanceTimersByTimeAsync(0);
			form.setValue("/a.b", [{ "0": [{ "deep.key": "b" }, { "deep.key": "a" }] }]);
			await vi.advanceTimersByTimeAsync(0);
			expect(resolve).toHaveLength(4);
			for (const old of resolve.slice(0, 2)) old([{ code: "old", message: "bad", severity: "error" }]);
			await vi.advanceTimersByTimeAsync(0);
			expect(form.getState().issues).toEqual([]);
			for (const current of resolve.slice(2)) current([{ code: "new", message: "bad", severity: "error" }]);
			await vi.advanceTimersByTimeAsync(0);
			expect(form.getState().issues.map((issue) => issue.code)).toEqual(["new", "new"]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("uses typed literal string keys rather than numeric indices for explicit scopes", async () => {
		const observed: unknown[] = [];
		const prepared = createSchemaForm(
			{},
			{
				provider: jsonSchemaProvider(),
				side: "input",
				definition,
				asyncFieldValidators: [
					{
						id: "typed",
						fieldId: "leaf",
						validate: async ({ field }) => {
							observed.push(field.binding.segments);
							return [{ code: "typed", message: "bad", severity: "error" }];
						},
					},
				],
			},
		);
		const form = prepared.createForm({ initialData: { "a.b": [{ "0": [{ "deep.key": "x" }, { "deep.key": "y" }] }] } });
		expect((await form.validateAsync({ namespace: "data", segments: ["a.b", 0, 0, 1, "deep.key"] })).issues).toEqual(
			[],
		);
		expect(observed).toEqual([]);
		const result = await form.validateAsync({ namespace: "data", segments: ["a.b", 0, "0", 1, "deep.key"] });
		expect(result.issues.map((issue) => issue.path.segments)).toEqual([["a.b", 0, "0", 1, "deep.key"]]);
		expect(observed).toHaveLength(1);
	});

	it("runs both conditional branches, including retained hidden field data", async () => {
		const branch = {
			version: 1 as const,
			id: "branches",
			root: {
				type: "conditional" as const,
				id: "choice",
				condition: { kind: "literal" as const, value: true },
				then: [{ type: "field" as const, id: "on", widget: "text", binding: { namespace: "data", segments: ["on"] } }],
				else: [
					{ type: "field" as const, id: "off", widget: "text", binding: { namespace: "data", segments: ["off"] } },
				],
			},
		};
		const prepared = createSchemaForm(
			{},
			{
				provider: jsonSchemaProvider(),
				side: "input",
				definition: branch,
				asyncFieldValidators: ["on", "off"].map((fieldId) => ({
					id: `async-${fieldId}`,
					fieldId,
					validate: async () => [{ code: fieldId, message: "bad", severity: "error" as const }],
				})),
			},
		);
		const form = prepared.createForm({ initialData: { on: "yes", off: "no" } });
		expect((await form.validateAsync()).issues.map((issue) => issue.code)).toEqual(["off", "on"]);
	});

	it("defers scoped publication until legacy completes and rejects aborted late results", async () => {
		const generated = createSchemaForm(
			{ type: "object", properties: { name: { type: "string" } } },
			{
				provider: jsonSchemaProvider(),
				side: "input",
				generation: {},
			},
		);
		const root = generated.definition.root;
		if (root.type !== "group" || root.children[0]?.type !== "field") throw new Error("Missing generated field");
		const fieldId = root.children[0].id;
		const prepared = createSchemaForm(
			{ type: "object", properties: { name: { type: "string" } } },
			{
				provider: jsonSchemaProvider(),
				side: "input",
				generation: {},
				asyncFieldValidators: [
					{ id: "scoped", fieldId, validate: async () => [{ code: "scoped", message: "bad", severity: "error" }] },
				],
			},
		);
		let resolveLegacy: ((issues: never[]) => void) | undefined;
		const form = prepared.createForm({
			initialData: { name: "Ada" },
			asyncValidators: [
				{
					id: "legacy",
					validate: () =>
						new Promise((resolve) => {
							resolveLegacy = resolve;
						}),
				},
			],
		});
		const pending = form.validateAsync();
		await Promise.resolve();
		expect(form.getState().issues).toEqual([]);
		resolveLegacy?.([]);
		expect((await pending).issues.map((issue) => issue.code)).toEqual(["scoped"]);
		const controller = new AbortController();
		const aborted = form.validateAsync(undefined, controller.signal);
		controller.abort();
		expect((await aborted).status).toBe("aborted");
		resolveLegacy?.([]);
		await Promise.resolve();
		expect(form.getState().issues.map((issue) => issue.code)).toEqual(["scoped"]);
	});

	it("rejects invalid definitions and async ID collisions before validation", () => {
		const options = { provider: jsonSchemaProvider(), side: "input" as const, definition };
		const valid = { id: "scoped", fieldId: "leaf", validate: async () => [] };
		for (const fieldId of ["outer", "unknown"]) {
			expect(() => createSchemaForm({}, { ...options, asyncFieldValidators: [{ ...valid, fieldId }] })).toThrow();
		}
		for (const entries of [
			[valid, valid],
			[{ ...valid, debounceMs: -1 }],
			[{ ...valid, trigger: "bad" as "onBlur" }],
		]) {
			expect(() => createSchemaForm({}, { ...options, asyncFieldValidators: entries })).toThrow();
		}
		const prepared = createSchemaForm({}, { ...options, asyncFieldValidators: [valid] });
		expect(() =>
			prepared.createForm({
				asyncValidators: [{ id: "scoped", validate: async () => [] }],
			}),
		).toThrow("Duplicate async validator id");
	});

	it("runs every concrete nested row alongside legacy async on a full draft, retaining minted issues", async () => {
		const observed: unknown[] = [];
		const prepared = createSchemaForm(
			{},
			{
				provider: jsonSchemaProvider(),
				side: "input",
				definition,
				asyncFieldValidators: [
					{
						id: "unique-leaf",
						fieldId: "leaf",
						validate: async ({ field }) => {
							observed.push([field.instance.instanceKey, field.binding.segments]);
							return [{ code: "scoped", message: "bad", severity: "error" as const }];
						},
					},
				],
			},
		);
		const form = prepared.createForm({
			initialData: { "a.b": [{ "0": [{ "deep.key": "x" }, { "deep.key": "y" }] }] },
			asyncValidators: [legacyAsyncValidator],
		});
		const result = await form.validateAsync();
		expect(result.status).toBe("completed");
		expect(result.issues.map((issue) => issue.code)).toEqual(["legacy", "scoped", "scoped"]);
		expect(result.issues.filter((issue) => issue.code === "scoped").map((issue) => issue.path.segments)).toEqual([
			["a.b", 0, "0", 0, "deep.key"],
			["a.b", 0, "0", 1, "deep.key"],
		]);
		expect(observed).toHaveLength(2);
		for (const issue of result.issues.filter((entry) => entry.code === "scoped"))
			expect(form.getState().issues).toContain(issue);
		form.reset({ data: { "a.b": [] } });
		expect((await form.validateAsync()).issues.map((issue) => issue.code)).toEqual(["legacy"]);
	});
});
