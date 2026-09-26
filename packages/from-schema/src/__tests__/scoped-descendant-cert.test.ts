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

test("async FINAL certifies only the existing typed child", async () => {
	const prepared = createSchemaForm(
		{},
		{
			provider: jsonSchemaProvider(),
			side: "input",
			definition,
			asyncFieldValidators: [{ id: "async-child", fieldId: "object", validate: async () => [child(["0"])] }],
		},
	);
	const form = prepared.createForm({ initialData });
	try {
		const result = await runScopedCandidate(
			form,
			{ data: form.getState().data, uiState: form.getState().uiState },
			undefined,
			undefined,
			new AbortController().signal,
			0,
			() => 0,
		);
		expect(result[0]?.path.segments).toEqual(["a.b", "0"]);
		if (!result[0]) throw new Error("Missing issue");
		expect(issueEmissionId(result[0])).toBeTruthy();
	} finally {
		form.dispose();
	}
});

test("nested repeater object fields retain numeric indices and string keys", () => {
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
			fieldValidators: [{ fieldId: "object", validate: () => [child(["0"])] }],
		},
	);
	const form = prepared.createForm({
		initialData: { "a.b": [{ "0": [{ "deep.key": { "0": "x", other: "private" } }] }] },
	});
	try {
		expect(form.validate()[0]?.path.segments).toEqual(["a.b", 0, "0", 0, "deep.key", "0"]);
	} finally {
		form.dispose();
	}
});
