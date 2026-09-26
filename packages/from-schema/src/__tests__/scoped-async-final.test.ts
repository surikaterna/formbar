import { expect, test } from "vitest";
import { issueEmissionId } from "../../../core/src/issue-provenance.js";
import { runScopedCandidate } from "../../../core/src/scoped-async-candidate.js";
import { createSchemaForm, jsonSchemaProvider } from "../index.js";

const definition = {
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

test("FINAL fans out typed nested instances on candidate bytes without debouncing or replacing retained draft", async () => {
	const seen: unknown[] = [];
	const form = createSchemaForm(
		{},
		{
			provider: jsonSchemaProvider(),
			side: "input",
			definition,
			asyncFieldValidators: [
				{
					id: "leaf-async",
					fieldId: "leaf",
					trigger: "onBlur",
					debounceMs: 99999,
					validate: async ({ data, uiState, field, stage, context }) => {
						seen.push([data, uiState, field.binding.segments, stage, context]);
						return [{ code: "bad", message: "bad", severity: "error" }];
					},
				},
			],
		},
	).createForm({
		initialData: { "a.b": [{ "0": [{ "deep.key": "a" }, { "deep.key": "b" }] }] },
		initialUiState: { tab: 1 },
	});
	try {
		const data = Object.freeze({
			"a.b": Object.freeze([
				{ "0": Object.freeze([Object.freeze({ "deep.key": "new" }), Object.freeze({ "deep.key": "next" })]) },
			]),
		});
		const result = await runScopedCandidate(
			form,
			{ data, uiState: form.getState().uiState },
			"review",
			{ requestId: "final", at: "now" },
			new AbortController().signal,
			0,
			() => 0,
		);
		expect(result.map((entry) => entry.path.segments)).toEqual([
			["a.b", 0, "0", 0, "deep.key"],
			["a.b", 0, "0", 1, "deep.key"],
		]);
		expect(result.map(issueEmissionId).every(Boolean)).toBe(true);
		expect(seen).toHaveLength(2);
		expect(seen[0]).toMatchObject([data, { tab: 1 }, ["a.b", 0, "0", 0, "deep.key"], "review", { requestId: "final" }]);
		expect(form.getState().data["a.b"][0]?.["0"][0]?.["deep.key"]).toBe("a");
		form.reset({ data: { "a.b": [] } });
		expect(
			await runScopedCandidate(
				form,
				{ data: form.getState().data, uiState: form.getState().uiState },
				undefined,
				undefined,
				new AbortController().signal,
				0,
				() => 0,
			),
		).toEqual([]);
	} finally {
		form.dispose();
	}
});

test.each(["reset", "dispose", "reorder", "abort"] as const)("FINAL rejects stale %s results", async (action) => {
	let resolve!: (value: readonly { code: string; message: string; severity: "error" }[]) => void;
	const pending = new Promise<readonly { code: string; message: string; severity: "error" }[]>((done) => {
		resolve = done;
	});
	const form = createSchemaForm(
		{},
		{
			provider: jsonSchemaProvider(),
			side: "input",
			definition,
			asyncFieldValidators: [{ id: "leaf-async", fieldId: "leaf", validate: () => pending }],
		},
	).createForm({ initialData: { "a.b": [{ "0": [{ "deep.key": "a" }] }] } });
	const controller = new AbortController();
	try {
		const run = runScopedCandidate(
			form,
			{ data: form.getState().data, uiState: form.getState().uiState },
			undefined,
			undefined,
			controller.signal,
			0,
			() => 0,
		);
		if (action === "abort") controller.abort();
		else if (action === "dispose") form.dispose();
		else if (action === "reset") form.reset();
		else form.field("a.b").set([{ "0": [{ "deep.key": "b" }] }]);
		resolve([{ code: "bad", message: "bad", severity: "error" }]);
		await expect(run).rejects.toThrow();
	} finally {
		form.dispose();
	}
});

test("FINAL evaluates both conditional branches on the same candidate snapshot", async () => {
	const seen: string[] = [];
	const form = createSchemaForm(
		{},
		{
			provider: jsonSchemaProvider(),
			side: "input",
			definition: {
				version: 1,
				id: "branches",
				root: {
					type: "conditional",
					id: "choice",
					condition: { kind: "literal", value: true },
					then: [{ type: "field", id: "on", widget: "text", binding: { namespace: "data", segments: ["on"] } }],
					else: [{ type: "field", id: "off", widget: "text", binding: { namespace: "data", segments: ["off"] } }],
				},
			},
			asyncFieldValidators: ["on", "off"].map((fieldId) => ({
				id: fieldId,
				fieldId,
				validate: async ({ data }) => {
					seen.push((data as { on: string }).on);
					return [{ code: fieldId, message: fieldId, severity: "error" as const }];
				},
			})),
		},
	).createForm({ initialData: { on: "draft", off: "draft" } });
	try {
		const result = await runScopedCandidate(
			form,
			{ data: { on: "final", off: "final" }, uiState: form.getState().uiState },
			undefined,
			undefined,
			new AbortController().signal,
			0,
			() => 0,
		);
		expect(result.map((entry) => entry.code)).toEqual(["on", "off"]);
		expect(seen).toEqual(["final", "final"]);
	} finally {
		form.dispose();
	}
});
