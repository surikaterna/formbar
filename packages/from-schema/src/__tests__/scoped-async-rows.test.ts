import { afterEach, expect, test, vi } from "vitest";
import { createSchemaForm, jsonSchemaProvider } from "../index.js";

const definition = {
	version: 1 as const,
	id: "rows",
	root: {
		type: "repeater" as const,
		id: "items",
		scope: "row",
		binding: { namespace: "data", segments: ["rows"] },
		children: [
			{
				type: "field" as const,
				id: "value",
				widget: "text",
				binding: { namespace: "data", scope: "row", segments: ["value"] },
			},
		],
	},
};

afterEach(() => vi.useRealTimers());

test("unrelated row change rebinds capture without restarting the sibling's debounce deadline", async () => {
	vi.useFakeTimers();
	const calls: string[] = [];
	const form = createSchemaForm(
		{},
		{
			provider: jsonSchemaProvider(),
			side: "input",
			definition,
			asyncFieldValidators: [
				{
					id: "row",
					fieldId: "value",
					debounceMs: 100,
					validate: async ({ field }) => {
						calls.push(field.instance.instanceKey);
						return [{ code: "BAD", message: "bad", severity: "error" }];
					},
				},
			],
		},
	).createForm({ initialData: { rows: [{ value: "a" }, { value: "b" }] } });
	try {
		form.field("rows.0.value").set("first");
		await vi.advanceTimersByTimeAsync(50);
		form.field("rows.1.value").set("second");
		await vi.advanceTimersByTimeAsync(50);
		expect(calls).toHaveLength(1);
		expect(form.getState().issues).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(50);
		expect(calls).toHaveLength(2);
		expect(new Set(calls).size).toBe(2);
		expect(form.getState().issues).toHaveLength(2);
	} finally {
		form.dispose();
	}
});

test.each(["onChange", "onBlur"] as const)(
	"prepared scoped %s settles both siblings independently",
	async (trigger) => {
		vi.useFakeTimers();
		const seen: string[] = [];
		const prepared = createSchemaForm(
			{},
			{
				provider: jsonSchemaProvider(),
				side: "input",
				definition,
				asyncFieldValidators: [
					{
						id: "unique",
						fieldId: "value",
						trigger,
						debounceMs: 300,
						validate: async ({ field }) => {
							seen.push(field.instance.instanceKey);
							return [{ code: "BAD", message: "bad", severity: "error" }];
						},
					},
				],
			},
		);
		const form = prepared.createForm({ initialData: { rows: [{ value: "a" }, { value: "b" }] } });
		try {
			for (const index of [0, 1]) {
				const field = form.field(`rows.${index}.value`);
				if (trigger === "onChange") expect(field.set(`changed${index}`)).toEqual({ ok: true });
				else field.handleBlur();
			}
			await vi.advanceTimersByTimeAsync(300);
			expect(seen).toHaveLength(2);
			expect(new Set(seen).size).toBe(2);
			expect(form.getState().issues.map((issue) => issue.path.segments)).toEqual([
				["rows", 0, "value"],
				["rows", 1, "value"],
			]);
		} finally {
			form.dispose();
		}
	},
);

test("full-draft invokes each scoped instance and legacy exactly once, retaining originals after validating:false", async () => {
	const scoped = vi.fn(async () => [{ code: "BAD", message: "bad", severity: "error" as const }]);
	const legacy = vi.fn(async () => [
		{
			code: "LEGACY",
			message: "legacy",
			severity: "error" as const,
			path: { namespace: "data" as const, segments: ["rows", 0, "value"] },
			source: { origin: "async-validator" as const, validatorId: "legacy" },
		},
	]);
	const prepared = createSchemaForm(
		{},
		{
			provider: jsonSchemaProvider(),
			side: "input",
			definition,
			asyncFieldValidators: [{ id: "unique", fieldId: "value", validate: scoped }],
		},
	);
	const form = prepared.createForm({
		initialData: { rows: [{ value: "a" }, { value: "b" }] },
		asyncValidators: [{ id: "legacy", validate: legacy }],
	});
	try {
		const notices = vi.fn();
		form.subscribe(notices);
		const result = await form.validateAsync();
		expect(result.status).toBe("completed");
		expect(scoped).toHaveBeenCalledTimes(2);
		expect(legacy).toHaveBeenCalledOnce();
		expect(result.issues).toHaveLength(3);
		for (const issue of result.issues.filter((item) => item.source.validatorId === "unique"))
			expect(form.getState().issues).toContain(issue);
		expect(form.getState().issues.find((issue) => issue.source.validatorId === "legacy")?.code).toBe("LEGACY");
		expect(form.getState().meta.validation.validating).toBe(false);
		expect(notices).toHaveBeenCalledTimes(3);
	} finally {
		form.dispose();
	}
});

test("scoped foreground replaces only the targeted instance's automatic original", async () => {
	vi.useFakeTimers();
	const form = createSchemaForm(
		{},
		{
			provider: jsonSchemaProvider(),
			side: "input",
			definition,
			asyncFieldValidators: [
				{
					id: "row",
					fieldId: "value",
					trigger: "onBlur",
					debounceMs: 0,
					validate: async () => [{ code: "BAD", message: "bad", severity: "error" }],
				},
			],
		},
	).createForm({ initialData: { rows: [{ value: "a" }, { value: "b" }] } });
	try {
		form.field("rows.0.value").handleBlur();
		form.field("rows.1.value").handleBlur();
		await vi.advanceTimersByTimeAsync(0);
		const [first, sibling] = form.getState().issues;
		expect(first).toBeDefined();
		expect(sibling).toBeDefined();
		const result = await form.validateAsync(["rows", 0, "value"]);
		expect(result.status).toBe("completed");
		expect(result.issues).toHaveLength(1);
		expect(result.issues[0]).not.toBe(first);
		expect(form.getState().issues).not.toContain(first);
		expect(form.getState().issues).toContain(sibling);
		expect(form.getState().issues).toContain(result.issues[0]);
	} finally {
		form.dispose();
	}
});

test("zero rows completes without invoking a scoped producer", async () => {
	const validate = vi.fn(async () => [{ code: "BAD", message: "bad", severity: "error" as const }]);
	const form = createSchemaForm(
		{},
		{
			provider: jsonSchemaProvider(),
			side: "input",
			definition,
			asyncFieldValidators: [{ id: "row", fieldId: "value", validate }],
		},
	).createForm({ initialData: { rows: [] } });
	try {
		expect(await form.validateAsync()).toEqual({ status: "completed", issues: [] });
		expect(validate).not.toHaveBeenCalled();
	} finally {
		form.dispose();
	}
});

test.each(["malformed", "timeout"] as const)(
	"automatic %s result fails closed and settles without unhandled rejection",
	async (kind) => {
		vi.useFakeTimers();
		const prepared = createSchemaForm(
			{},
			{
				provider: jsonSchemaProvider(),
				side: "input",
				definition,
				asyncFieldValidators: [
					{
						id: "row",
						fieldId: "value",
						trigger: "onBlur",
						debounceMs: 0,
						validate: async () =>
							kind === "malformed"
								? [{ code: "BAD", message: "bad", severity: "error", descendant: ["missing"] }]
								: new Promise(() => {}),
					},
				],
			},
		);
		const form = prepared.createForm({
			initialData: { rows: [{ value: "a" }] },
			timeouts: { validator: 50 },
		});
		try {
			form.field("rows.0.value").handleBlur();
			await vi.advanceTimersByTimeAsync(51);
			expect(form.getState().issues.map((issue) => issue.code)).toEqual(["ASYNC_VALIDATOR_EXCEPTION"]);
			expect(form.getState().meta.validation.validating).toBe(false);
		} finally {
			form.dispose();
		}
	},
);

test("malformed scoped foreground rejects and clears validating without publishing partial originals", async () => {
	const form = createSchemaForm(
		{},
		{
			provider: jsonSchemaProvider(),
			side: "input",
			definition,
			asyncFieldValidators: [
				{
					id: "row",
					fieldId: "value",
					validate: async ({ field }) =>
						field.binding.segments[1] === 0
							? [{ code: "BAD", message: "bad", severity: "error" }]
							: [{ code: "BAD", message: "bad", severity: "error", descendant: ["missing"] }],
				},
			],
		},
	).createForm({ initialData: { rows: [{ value: "a" }, { value: "b" }] } });
	try {
		await expect(form.validateAsync()).rejects.toThrow("Invalid scoped async issue");
		expect(form.getState().meta.validation.validating).toBe(false);
		expect(form.getState().issues).toEqual([]);
	} finally {
		form.dispose();
	}
});

test.each(["issues", "validating:false"] as const)(
	"abort during scoped %s notification never completes",
	async (phase) => {
		const controller = new AbortController();
		const form = createSchemaForm(
			{},
			{
				provider: jsonSchemaProvider(),
				side: "input",
				definition,
				asyncFieldValidators: [
					{ id: "row", fieldId: "value", validate: async () => [{ code: "BAD", message: "bad", severity: "error" }] },
				],
			},
		).createForm({ initialData: { rows: [{ value: "a" }, { value: "b" }] } });
		form.subscribe((state) => {
			if (controller.signal.aborted) return;
			if (phase === "issues" ? state.issues.length === 2 : !state.meta.validation.validating) controller.abort();
		});
		try {
			expect(await form.validateAsync(undefined, controller.signal)).toEqual({ status: "aborted", issues: [] });
			expect(form.getState().meta.validation.validating).toBe(false);
		} finally {
			form.dispose();
		}
	},
);

test("explicit typed nested scope selects one concrete row without coercing literal dotted and string-zero keys", async () => {
	const nested = {
		version: 1 as const,
		id: "nested",
		root: {
			type: "repeater" as const,
			id: "outer",
			scope: "outer",
			binding: { namespace: "data", segments: ["a.b"] },
			children: [
				{
					type: "repeater" as const,
					id: "inner",
					scope: "inner",
					binding: { namespace: "data", scope: "outer", segments: ["0"] },
					children: [
						{
							type: "field" as const,
							id: "leaf",
							widget: "text",
							binding: { namespace: "data", scope: "inner", segments: ["deep.key"] },
						},
					],
				},
			],
		},
	};
	const seen: unknown[] = [];
	const form = createSchemaForm(
		{},
		{
			provider: jsonSchemaProvider(),
			side: "input",
			definition: nested,
			asyncFieldValidators: [
				{
					id: "leaf",
					fieldId: "leaf",
					validate: async ({ field }) => {
						seen.push(field.instance.scopes);
						return [{ code: "BAD", message: "bad", severity: "error" }];
					},
				},
			],
		},
	).createForm({ initialData: { "a.b": [{ "0": [{ "deep.key": "a" }, { "deep.key": "b" }] }] } });
	try {
		const scope = { namespace: "data" as const, segments: ["a.b", 0, "0", 1, "deep.key"] };
		expect((await form.validateAsync(scope)).issues.map((issue) => issue.path.segments)).toEqual([scope.segments]);
		expect(seen).toHaveLength(1);
		expect(form.getState().issues).toHaveLength(1);
		expect((await form.validateAsync()).issues.map((issue) => issue.path.segments)).toEqual([
			["a.b", 0, "0", 0, "deep.key"],
			["a.b", 0, "0", 1, "deep.key"],
		]);
	} finally {
		form.dispose();
	}
});
