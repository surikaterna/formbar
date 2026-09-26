import { expect, test } from "vitest";
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

function prepared(
	validate: (input: { readonly data: unknown }) => Promise<
		readonly {
			readonly code: string;
			readonly message: string;
			readonly severity: "error";
		}[]
	>,
) {
	return createSchemaForm(
		{},
		{
			provider: jsonSchemaProvider(),
			side: "input",
			definition,
			asyncFieldValidators: [{ id: "row", fieldId: "value", trigger: "onBlur", validate }],
		},
	);
}

test.each(["reorder", "reset", "dispose"] as const)("%s invalidates unfinished scoped foreground", async (action) => {
	let resolve!: (value: readonly { code: string; message: string; severity: "error" }[]) => void;
	const pending = new Promise<readonly { code: string; message: string; severity: "error" }[]>((done) => {
		resolve = done;
	});
	const form = prepared(async () => pending).createForm({ initialData: { rows: [{ value: "a" }] } });
	const result = form.validateAsync();
	if (action === "reorder") form.setValue("rows", [{ value: "b" }]);
	if (action === "reset") form.reset();
	if (action === "dispose") form.dispose();
	resolve([{ code: "BAD", message: "bad", severity: "error" }]);
	expect(await result).toMatchObject({ issues: [] });
	expect(form.getState().issues).toEqual([]);
	form.dispose();
});

test.each(["issues", "validating:false"] as const)(
	"reentrant new foreground during %s notification supersedes prior scoped result",
	async (phase) => {
		let count = 0;
		let finish!: (value: readonly { code: string; message: string; severity: "error" }[]) => void;
		const pending = new Promise<readonly { code: string; message: string; severity: "error" }[]>((resolve) => {
			finish = resolve;
		});
		const form = prepared(async () => {
			count++;
			return count === 1 ? [{ code: "FIRST", message: "bad", severity: "error" }] : pending;
		}).createForm({ initialData: { rows: [{ value: "a" }] } });
		let newer: ReturnType<typeof form.validateAsync> | undefined;
		form.subscribe((state) => {
			if (newer || count !== 1) return;
			if (phase === "issues" ? state.issues[0]?.code === "FIRST" : !state.meta.validation.validating)
				newer = form.validateAsync();
		});
		try {
			expect(await form.validateAsync()).toEqual({ status: "superseded", issues: [] });
			expect(newer).toBeDefined();
			finish([{ code: "SECOND", message: "bad", severity: "error" }]);
			expect((await newer)?.status).toBe("completed");
			expect(form.getState().issues.map((issue) => issue.code)).toEqual(["SECOND"]);
		} finally {
			form.dispose();
		}
	},
);

test.each(["issues", "validating:false"] as const)(
	"reentrant data edit during scoped %s notification invalidates completed status and stale issues",
	async (phase) => {
		const form = prepared(async () => [{ code: "FIRST", message: "bad", severity: "error" }]).createForm({
			initialData: { rows: [{ value: "a" }] },
		});
		let changed = false;
		form.subscribe((state) => {
			if (changed) return;
			if (phase === "issues" ? state.issues[0]?.code === "FIRST" : !state.meta.validation.validating) {
				changed = true;
				form.setValue("rows.0.value", "edited");
			}
		});
		try {
			expect(await form.validateAsync()).toEqual({ status: "superseded", issues: [] });
			expect(changed).toBe(true);
			expect(form.getState().issues).toEqual([]);
		} finally {
			form.dispose();
		}
	},
);
