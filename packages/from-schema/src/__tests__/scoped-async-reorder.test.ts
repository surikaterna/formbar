import { afterEach, describe, expect, it, vi } from "vitest";
import { OwnershipOverlapIndex } from "../../../declarative/src/ownership-overlap-index.js";
import { createSchemaForm, jsonSchemaProvider } from "../index.js";

const definition = {
	version: 1 as const,
	id: "reorder",
	root: {
		type: "repeater" as const,
		id: "rows",
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

function formFor(trigger: "onChange" | "onBlur") {
	return createSchemaForm(
		{},
		{
			provider: jsonSchemaProvider(),
			side: "input",
			definition,
			asyncFieldValidators: [
				{
					id: "scoped",
					fieldId: "value",
					trigger,
					debounceMs: 20,
					validate: async ({ data, field }) => [
						{
							code: `scoped:${(data as { rows: { value: string }[] }).rows[field.binding.segments[1] as number]?.value}`,
							message: "bad",
							severity: "error",
						},
					],
				},
			],
		},
	).createForm({
		initialData: { rows: [{ value: "a" }, { value: "b" }] },
		asyncValidators: [
			{
				id: "legacy",
				validate: async () => [
					{
						code: "scoped:a",
						message: "bad",
						severity: "error" as const,
						path: { namespace: "data" as const, segments: ["rows", 0, "value"] },
						source: { origin: "async-validator" as const, validatorId: "legacy" },
					},
				],
			},
		],
	});
}

afterEach(() => vi.useRealTimers());

const nested = {
	version: 1 as const,
	id: "nested",
	root: {
		type: "repeater" as const,
		id: "groups",
		scope: "group",
		binding: { namespace: "data" as const, segments: ["groups"] },
		children: [
			{
				type: "repeater" as const,
				id: "rows",
				scope: "row",
				binding: { namespace: "data" as const, scope: "group", segments: ["rows"] },
				children: [
					{
						type: "field" as const,
						id: "value",
						widget: "text",
						binding: { namespace: "data" as const, scope: "row", segments: ["value"] },
					},
				],
			},
		],
	},
};

function nestedForm(count: number, trigger: "onBlur" | "onChange" = "onBlur") {
	return createSchemaForm(
		{},
		{
			provider: jsonSchemaProvider(),
			side: "input",
			definition: nested,
			asyncFieldValidators: [
				{
					id: "scoped",
					fieldId: "value",
					trigger,
					validate: async () => [{ code: "bad", message: "bad", severity: "error" as const }],
				},
			],
		},
	).createForm({
		initialData: { groups: [{ rows: Array.from({ length: count }, (_, index) => ({ value: String(index) })) }] },
	});
}

describe("completed scoped issue ownership on recycled indices", () => {
	it.each([100, 300, 600])("reschedules %i pending change rows with keyed work", (count) => {
		vi.useFakeTimers();
		const form = nestedForm(count, "onChange");
		const rows = () => Array.from({ length: count }, (_, index) => ({ value: String(index) }));
		try {
			form.setValue("groups", [{ rows: rows() }]);
			let keys = 0;
			const stringify = JSON.stringify;
			const spy = vi.spyOn(JSON, "stringify").mockImplementation((value, ...args) => {
				if (Array.isArray(value) && value[0] === "scoped") keys++;
				return stringify(value, ...args);
			});
			try {
				form.setValue("groups", [{ rows: rows() }]);
			} finally {
				spy.mockRestore();
			}
			expect(keys).toBeGreaterThan(count);
			expect(keys).toBeLessThan(count * 20);
		} finally {
			form.dispose();
		}
	});
	it.each([100, 300, 600])("bounds real nested-row revocation for %i blur rows", async (count) => {
		const rows = () => Array.from({ length: count }, (_, index) => ({ value: String(index) }));
		const form = nestedForm(count);
		try {
			const result = await form.validateAsync();
			const originals = result.issues;
			expect(originals).toHaveLength(count);
			let visits = 0;
			let notifications = 0;
			const unsubscribe = form.subscribe(() => {
				notifications++;
			});
			const check = (next: { value: string }[]) => {
				visits = 0;
				notifications = 0;
				const filter = Array.prototype.filter;
				const spy = vi.spyOn(Array.prototype, "filter").mockImplementation(function (
					this: unknown[],
					...args: Parameters<typeof filter>
				) {
					if (this[0] === originals[0]) visits += this.length;
					return filter.apply(this, args);
				});
				try {
					form.setValue("groups", [{ rows: next }]);
				} finally {
					spy.mockRestore();
				}
				expect(form.getState().issues).toEqual([]);
				expect(notifications).toBeLessThanOrEqual(4);
				if (next[0]?.value === "0") expect(visits).toBeGreaterThan(0);
				expect(visits).toBeLessThan(count * 20);
			};
			check(rows());
			await form.validateAsync();
			const current = (form.getState().data as { groups: { rows: { value: string }[] }[] }).groups[0].rows;
			current[0].value = "mutated";
			check(current);
			await form.validateAsync();
			check(rows().reverse());
			unsubscribe();
		} finally {
			form.dispose();
		}
	});
	it.each(
		[100, 300, 600].flatMap((count) => (["onBlur", "onChange"] as const).map((trigger) => [count, trigger] as const)),
	)("bounds total projection and host visits for %i real nested %s rows", async (count, trigger) => {
		const form = nestedForm(count, trigger);
		try {
			await form.validateAsync();
			let indexVisits = 0;
			let mapVisits = 0;
			let ownerScans = 0;
			let rowEnumerations = 0;
			let notifications = 0;
			const unsubscribe = form.subscribe(() => notifications++);
			const add = OwnershipOverlapIndex.prototype.add;
			const query = OwnershipOverlapIndex.prototype.query;
			const get = Map.prototype.get;
			const some = Array.prototype.some;
			const ownKeys = Reflect.ownKeys;
			const addSpy = vi.spyOn(OwnershipOverlapIndex.prototype, "add").mockImplementation(function (path) {
				indexVisits++;
				return add.call(this, path);
			});
			const querySpy = vi.spyOn(OwnershipOverlapIndex.prototype, "query").mockImplementation(function (path) {
				indexVisits++;
				return query.call(this, path);
			});
			const mapSpy = vi.spyOn(Map.prototype, "get").mockImplementation(function (key) {
				mapVisits++;
				return get.call(this, key);
			});
			const someSpy = vi.spyOn(Array.prototype, "some").mockImplementation(function (
				this: unknown[],
				...args: Parameters<typeof some>
			) {
				if (this.length === count && (this[0] as { instance?: { nodeId?: string } })?.instance?.nodeId === "value")
					ownerScans += this.length;
				return some.apply(this, args);
			});
			const keysSpy = vi.spyOn(Reflect, "ownKeys").mockImplementation((value) => {
				if (Array.isArray(value) && value.length === count) rowEnumerations++;
				return ownKeys(value);
			});
			try {
				form.setValue("groups", [{ rows: Array.from({ length: count }, (_, index) => ({ value: String(index) })) }]);
			} finally {
				someSpy.mockRestore();
				keysSpy.mockRestore();
				mapSpy.mockRestore();
				querySpy.mockRestore();
				addSpy.mockRestore();
				unsubscribe();
			}
			console.info("#274 total projection+host index/map visits", {
				count,
				trigger,
				indexVisits,
				mapVisits,
				ownerScans,
				rowEnumerations,
			});
			expect(indexVisits).toBeGreaterThan(count);
			expect(indexVisits).toBeLessThan(40 * count);
			expect(mapVisits).toBeLessThan(100 * count);
			expect(ownerScans).toBe(0);
			expect(rowEnumerations).toBeLessThan(10);
			expect(notifications).toBe(2);
			expect(form.getState().issues).toEqual([]);
		} finally {
			form.dispose();
		}
	});
	it.each(["onBlur", "onChange"] as const)(
		"invalidates completed foreground %s rows without restarting blur",
		async (trigger) => {
			vi.useFakeTimers();
			const form = formFor(trigger);
			try {
				const first = await form.validateAsync();
				expect(first.status).toBe("completed");
				const originals = first.issues.filter((issue) => issue.source.validatorId === "scoped");
				expect(originals.map((issue) => issue.code)).toEqual(["scoped:a", "scoped:b"]);
				form.setValue("rows", [{ value: "b" }, { value: "a" }]);
				const immediate = form.getState().issues;
				for (const original of originals) expect(immediate).not.toContain(original);
				expect(immediate.map((issue) => issue.source.validatorId)).toEqual(["legacy"]);
				await vi.advanceTimersByTimeAsync(20);
				expect(form.getState().issues.map((issue) => issue.source.validatorId)).toEqual(
					trigger === "onBlur" ? ["legacy"] : ["legacy", "scoped", "scoped"],
				);
			} finally {
				form.dispose();
			}
		},
	);

	it("invalidates completed automatic rows on reuse before debounce and preserves legacy", async () => {
		vi.useFakeTimers();
		const form = formFor("onChange");
		try {
			form.setValue("rows", [{ value: "a" }, { value: "b" }]);
			await vi.advanceTimersByTimeAsync(20);
			const originals = form.getState().issues.filter((issue) => issue.source.validatorId === "scoped");
			expect(originals).toHaveLength(2);
			form.setValue("rows", [{ value: "b" }, { value: "a" }]);
			for (const original of originals) expect(form.getState().issues).not.toContain(original);
			expect(form.getState().issues.map((issue) => issue.code)).toEqual([]);
			await vi.advanceTimersByTimeAsync(20);
			expect(form.getState().issues.map((issue) => issue.code)).toEqual(["scoped:b", "scoped:a"]);
		} finally {
			form.dispose();
		}
	});

	it("fails closed on indistinguishable structural array replacement without claiming row IDs", async () => {
		const form = formFor("onBlur");
		try {
			const first = await form.validateAsync();
			const originals = first.issues.filter((issue) => issue.source.validatorId === "scoped");
			form.setValue("rows", [{ value: "a" }, { value: "b" }]);
			for (const original of originals) expect(form.getState().issues).not.toContain(original);
			expect(form.getState().issues.map((issue) => issue.source.validatorId)).toEqual(["legacy"]);
		} finally {
			form.dispose();
		}
	});
});
