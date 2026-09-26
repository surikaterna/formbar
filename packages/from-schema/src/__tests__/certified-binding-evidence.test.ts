import { expect, test } from "vitest";
import { certifiedExclusiveBinding } from "../../../declarative/src/certified-binding-evidence.js";
import { createSchemaForm, jsonSchemaProvider } from "../index.js";

const hidden = { kind: "literal" as const, value: false };

function prepared(options: { override?: "include"; visible?: boolean; sibling?: boolean } = {}) {
	return createSchemaForm(
		{},
		{
			provider: jsonSchemaProvider(),
			side: "input",
			definition: {
				version: 1 as const,
				id: "proof",
				submission: { hiddenValues: "omit-inactive" as const },
				root: {
					type: "group" as const,
					id: "root",
					children: [
						{
							type: "field" as const,
							id: "secret",
							widget: "text",
							binding: { namespace: "data", segments: ["secret"] },
							...(options.visible ? {} : { visible: hidden }),
							...(options.override ? { submitWhenHidden: options.override } : {}),
						},
						...(options.sibling
							? [
									{
										type: "field" as const,
										id: "shared",
										widget: "text",
										binding: { namespace: "data", segments: ["secret"] },
									},
								]
							: []),
					],
				},
			},
			fieldValidators: [
				{ fieldId: "secret", validate: () => [{ code: "bad", message: "same", severity: "error" as const }] },
			],
		},
	);
}

test.each(["certified first", "unowned first"])(
	"original emission survives normalized equal-looking unowned issue (%s)",
	(order) => {
		const form = prepared().createForm({ initialData: { secret: "draft" } });
		try {
			const certified = form.validate().find((issue) => issue.source.validatorId === "secret");
			if (!certified) throw Error("missing certified issue");
			const unowned = {
				...certified,
				path: { ...certified.path, segments: [...certified.path.segments] },
				source: { ...certified.source },
			};
			const issues = order === "certified first" ? [certified, unowned] : [unowned, certified];
			for (const issue of issues) expect(certifiedExclusiveBinding(issue)).toBe(issue === certified);
			form.reset();
			expect(certifiedExclusiveBinding(certified)).toBe(false);
		} finally {
			form.dispose();
		}
	},
);

test.each([{ override: "include" as const }, { visible: true }])("protects nonexclusive binding %j", (options) => {
	const form = prepared(options).createForm({ initialData: { secret: "draft" } });
	try {
		const issue = form.validate().find((entry) => entry.source.validatorId === "secret");
		expect(issue && certifiedExclusiveBinding(issue)).toBe(false);
	} finally {
		form.dispose();
	}
});

test("overlapping registered field rejects production instead of issuing an exclusive claim", () => {
	const form = prepared({ sibling: true }).createForm({ initialData: { secret: "draft" } });
	try {
		expect(() => form.validate()).toThrow("Unowned or overlapping field binding");
	} finally {
		form.dispose();
	}
});

test("associates nested typed instance bindings, then revokes every original on row reorder", () => {
	const form = createSchemaForm(
		{},
		{
			provider: jsonSchemaProvider(),
			side: "input",
			definition: {
				version: 1 as const,
				id: "nested",
				submission: { hiddenValues: "omit-inactive" as const },
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
									visible: hidden,
									binding: { namespace: "data", scope: "inner", segments: ["deep.key"] },
								},
							],
						},
					],
				},
			},
			fieldValidators: [{ fieldId: "leaf", validate: () => [{ code: "bad", message: "same", severity: "error" }] }],
		},
	).createForm({ initialData: { "a.b": [{ "0": [{ "deep.key": "a" }, { "deep.key": "b" }] }] } });
	try {
		const issues = form.validate().filter((issue) => issue.source.validatorId === "leaf");
		expect(issues.map((issue) => issue.path.segments)).toEqual([
			["a.b", 0, "0", 0, "deep.key"],
			["a.b", 0, "0", 1, "deep.key"],
		]);
		expect(issues.map(certifiedExclusiveBinding)).toEqual([true, true]);
		form.setValue("a.b", [{ "0": [{ "deep.key": "b" }, { "deep.key": "a" }] }]);
		expect(issues.map(certifiedExclusiveBinding)).toEqual([false, false]);
	} finally {
		form.dispose();
	}
});

test("async original is eligible only while its own projection and abort run are current", async () => {
	const preparedForm = prepared();
	const form = createSchemaForm(
		{},
		{
			provider: jsonSchemaProvider(),
			side: "input",
			definition: preparedForm.definition,
			asyncFieldValidators: [
				{
					id: "secret-async",
					fieldId: "secret",
					validate: async () => [{ code: "bad", message: "same", severity: "error" }],
				},
			],
		},
	).createForm({ initialData: { secret: "draft" } });
	try {
		const issue = (await form.validateAsync()).issues.find((entry) => entry.source.validatorId === "secret-async");
		expect(issue && certifiedExclusiveBinding(issue)).toBe(true);
		expect(issue && certifiedExclusiveBinding({ ...issue })).toBe(false);
		form.setValue("secret", "new");
		expect(issue && certifiedExclusiveBinding(issue)).toBe(false);
	} finally {
		form.dispose();
	}
});

test("an originally certified object child cannot inherit exclusive ownership across an unknown sibling", () => {
	const form = createSchemaForm(
		{},
		{
			provider: jsonSchemaProvider(),
			side: "input",
			definition: {
				version: 1 as const,
				id: "object",
				submission: { hiddenValues: "omit-inactive" as const },
				root: {
					type: "field" as const,
					id: "parent",
					widget: "text",
					visible: hidden,
					binding: { namespace: "data", segments: ["object"] },
				},
			},
			fieldValidators: [
				{
					fieldId: "parent",
					validate: () => [{ code: "bad", message: "same", severity: "error", descendant: ["child"] }],
				},
			],
		},
	).createForm({ initialData: { object: { child: "x", unknown: "keep" } } });
	try {
		const issue = form.validate().find((entry) => entry.source.validatorId === "parent");
		expect(issue?.path.segments).toEqual(["object", "child"]);
		expect(issue && certifiedExclusiveBinding(issue)).toBe(false);
	} finally {
		form.dispose();
	}
});
