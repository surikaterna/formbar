import { expect, test } from "vitest";
import { issueEmissionId } from "../../../core/src/issue-provenance.js";
import { runScopedCandidate } from "../../../core/src/scoped-async-candidate.js";
import { runScopedSync } from "../../../core/src/scoped-sync.js";
import { projectConcreteOwnership } from "../../../declarative/src/runtime-ownership.js";
import { createSchemaForm, jsonSchemaProvider } from "../index.js";

const child = (descendant: readonly (string | number)[] | undefined) => ({
	code: "child",
	message: "bad",
	severity: "error" as const,
	...(descendant === undefined ? {} : { descendant }),
});
const definition = {
	version: 1 as const,
	id: "object",
	root: { type: "field" as const, id: "object", widget: "text", binding: { namespace: "data", segments: ["a.b"] } },
};
const initialData = { "a.b": { "0": "x", other: "private" } };

test("existing object child certifies sync draft without certifying parent or omission", () => {
	const prepared = createSchemaForm(
		{},
		{
			provider: jsonSchemaProvider(),
			side: "input",
			definition,
			fieldValidators: [{ fieldId: "object", validate: () => [child(["0"])] }],
		},
	);
	const form = prepared.createForm({ initialData });
	try {
		const owner = projectConcreteOwnership({ form, definition: prepared.definition, capture: form.captureState() });
		expect(owner.forField("object")?.[0]?.eligible).toBe(false);
		expect(owner.unknown.map((path) => path.segments)).toEqual([
			["a.b", "0"],
			["a.b", "other"],
		]);
		const issue = form.validate()[0];
		if (!issue) throw new Error("Missing issue");
		expect(issue?.path.segments).toEqual(["a.b", "0"]);
		expect(issueEmissionId(issue)).toBeTruthy();
		expect(issueEmissionId({ ...issue })).toBeUndefined();
		const final = runScopedSync(form, undefined, {
			snapshot: { data: form.getState().data, uiState: form.getState().uiState },
			current: () => true,
			capture: form.captureState(),
		});
		expect(final[0]?.path.segments).toEqual(["a.b", "0"]);
		expect(form.getState().data).toEqual(initialData);
	} finally {
		form.dispose();
	}
});

test.each(["new", "old"] as const)("FINAL sync proves %s against candidate rather than retained child", (target) => {
	const retained = { "a.b": { old: "x" } };
	const candidate = { "a.b": { new: "valid" } };
	const observed: unknown[] = [];
	const prepared = createSchemaForm(
		{},
		{
			provider: jsonSchemaProvider(),
			side: "input",
			definition,
			fieldValidators: [
				{
					fieldId: "object",
					validate: ({ data }) => {
						observed.push(data);
						return [child([target])];
					},
				},
			],
		},
	);
	const form = prepared.createForm({ initialData: retained });
	try {
		const capture = form.captureState();
		const run = () =>
			runScopedSync(form, undefined, {
				snapshot: { data: candidate, uiState: capture.state.uiState },
				capture,
				current: () => true,
			});
		if (target === "new") {
			const issue = run()[0];
			expect(issue?.path.segments).toEqual(["a.b", "new"]);
			expect(issue && issueEmissionId(issue)).toBeTruthy();
		} else expect(run).toThrow("Invalid scoped field issue");
		expect(observed).toEqual([candidate]);
		expect(form.getState().data).toEqual(retained);
	} finally {
		form.dispose();
	}
});

test.each([undefined, ["other", "missing"], [0], ["missing"], ["__proto__"], ["a.b", "0"]] as const)(
	"rejects unproven descendant %s without a parent fallback",
	(descendant) => {
		const prepared = createSchemaForm(
			{},
			{
				provider: jsonSchemaProvider(),
				side: "input",
				definition,
				fieldValidators: [{ fieldId: "object", validate: () => [child(descendant)] }],
			},
		);
		const form = prepared.createForm({ initialData });
		try {
			expect(() => form.validate()).toThrow();
		} finally {
			form.dispose();
		}
	},
);

test("a second field overlapping the object blocks candidate-only child certification", () => {
	const overlapping = {
		version: 1 as const,
		id: "overlap",
		root: {
			type: "group" as const,
			id: "group",
			children: [
				definition.root,
				{
					type: "field" as const,
					id: "other",
					widget: "text",
					binding: { namespace: "data", segments: ["a.b", "new"] },
				},
			],
		},
	};
	const prepared = createSchemaForm(
		{},
		{
			provider: jsonSchemaProvider(),
			side: "input",
			definition: overlapping,
			fieldValidators: [{ fieldId: "object", validate: () => [child(["new"])] }],
		},
	);
	const form = prepared.createForm({ initialData: { "a.b": { old: "x", new: "retained" } } });
	try {
		const capture = form.captureState();
		expect(() =>
			runScopedSync(form, undefined, {
				capture,
				snapshot: { data: { "a.b": { new: "valid" } }, uiState: capture.state.uiState },
				current: () => true,
			}),
		).toThrow("overlapping");
	} finally {
		form.dispose();
	}
});

test.each(["new", "old"] as const)("async FINAL proves %s against candidate", async (target) => {
	const retained = { "a.b": { old: "x" } };
	const candidate = { "a.b": { new: "valid" } };
	const observed: unknown[] = [];
	const prepared = createSchemaForm(
		{},
		{
			provider: jsonSchemaProvider(),
			side: "input",
			definition,
			asyncFieldValidators: [
				{
					id: "async-child",
					fieldId: "object",
					validate: async ({ data }) => {
						observed.push(data);
						return [child([target])];
					},
				},
			],
		},
	);
	const form = prepared.createForm({ initialData: retained });
	try {
		const run = () =>
			runScopedCandidate(
				form,
				{ data: candidate, uiState: form.captureState().state.uiState },
				undefined,
				undefined,
				new AbortController().signal,
				0,
				() => 0,
			);
		if (target === "new") {
			const result = await run();
			expect(result[0]?.path.segments).toEqual(["a.b", "new"]);
			if (!result[0]) throw new Error("Missing issue");
			expect(issueEmissionId(result[0])).toBeTruthy();
		} else await expect(run()).rejects.toThrow();
		expect(observed).toEqual([candidate]);
		expect(form.getState().data).toEqual(retained);
	} finally {
		form.dispose();
	}
});

test("nested repeater object fields retain numeric indices and string keys", () => {
	let target = "0";
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
							id: "object",
							widget: "text",
							binding: { namespace: "data", scope: "inner", segments: ["deep.key"] },
						},
					],
				},
			],
		},
	};
	const prepared = createSchemaForm(
		{},
		{
			provider: jsonSchemaProvider(),
			side: "input",
			definition: nested,
			fieldValidators: [{ fieldId: "object", validate: () => [child([target])] }],
		},
	);
	const form = prepared.createForm({
		initialData: { "a.b": [{ "0": [{ "deep.key": { "0": "x", other: "private" } }] }] },
	});
	try {
		expect(form.validate()[0]?.path.segments).toEqual(["a.b", 0, "0", 0, "deep.key", "0"]);
		target = "new";
		const capture = form.captureState();
		const candidate = { "a.b": [{ "0": [{ "deep.key": { new: "valid" } }] }] };
		const result = runScopedSync(form, undefined, {
			capture,
			snapshot: { data: candidate, uiState: capture.state.uiState },
			current: () => true,
		});
		expect(result[0]?.path.segments).toEqual(["a.b", 0, "0", 0, "deep.key", "new"]);
		expect(result[0] && issueEmissionId(result[0])).toBeTruthy();
		target = "0";
		expect(() =>
			runScopedSync(form, undefined, {
				capture,
				snapshot: { data: candidate, uiState: capture.state.uiState },
				current: () => true,
			}),
		).toThrow();
	} finally {
		form.dispose();
	}
});
