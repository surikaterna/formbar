import { afterEach, expect, test, vi } from "vitest";
import { createSchemaForm, jsonSchemaProvider } from "../index.js";

const definition = {
	version: 1 as const,
	id: "nested",
	root: {
		type: "repeater" as const,
		id: "groups",
		scope: "group",
		binding: { namespace: "data", segments: ["groups"] },
		children: [
			{
				type: "repeater" as const,
				id: "rows",
				scope: "row",
				binding: { namespace: "data", scope: "group", segments: ["rows"] },
				children: [
					{
						type: "field" as const,
						id: "value",
						widget: "text",
						binding: { namespace: "data", scope: "row", segments: ["value"] },
					},
				],
			},
		],
	},
};

afterEach(() => vi.useRealTimers());

for (const trigger of ["onChange", "onBlur"] as const) {
	for (const count of [100, 300, 600]) {
		test(`${trigger} real ${count}-row settlement bounds data scans per completion`, async () => {
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
							trigger,
							debounceMs: 0,
							validate: async () => [{ code: "BAD", message: "bad", severity: "error" }],
						},
					],
				},
			);
			const rows = Array.from({ length: count }, (_, index) => ({ value: String(index) }));
			const form = prepared.createForm({ initialData: { groups: [{ rows }] } });
			const watched = new Set<object>([form.getState().data.groups[0].rows]);
			const original = Reflect.ownKeys;
			let total = 0;
			let notifications = 0;
			let maximum = 0;
			let last = 0;
			const originals: unknown[] = [];
			const stop = form.subscribe((state) => {
				notifications++;
				if (state.issues.length <= last) return;
				originals.push(state.issues[state.issues.length - 1]);
				maximum = Math.max(maximum, total - lastScan);
				lastScan = total;
				last = state.issues.length;
			});
			let lastScan = 0;
			Reflect.ownKeys = (target) => {
				if (watched.has(target)) total++;
				return original(target);
			};
			try {
				if (trigger === "onChange") {
					expect(form.setValue("groups.0.rows", rows)).toEqual({ ok: true });
					watched.add(form.getState().data.groups[0].rows);
				} else {
					for (let index = 0; index < count; index++) {
						const before = total;
						form.fieldDynamic(`groups.0.rows.${index}.value`).handleBlur();
						expect(total - before).toBeLessThanOrEqual(10);
					}
				}
				const synchronous = total;
				lastScan = synchronous;
				await vi.advanceTimersByTimeAsync(0);
				expect(form.getState().issues).toHaveLength(count);
				expect(originals).toHaveLength(count);
				for (const originalIssue of originals) expect(form.getState().issues).toContain(originalIssue);
				expect(new Set(form.getState().issues.map((issue) => JSON.stringify(issue.path.segments))).size).toBe(count);
				expect(synchronous).toBeLessThanOrEqual(trigger === "onChange" ? 10 : 10 * count);
				expect(total - synchronous).toBeLessThanOrEqual(12);
				expect(maximum).toBeLessThanOrEqual(12);
				expect(notifications).toBeLessThanOrEqual(2 * count + 5);
				console.info({ trigger, count, synchronous, total, maximum, notifications });
			} finally {
				Reflect.ownKeys = original;
				stop();
				form.dispose();
			}
		}, 30_000);
	}
}
