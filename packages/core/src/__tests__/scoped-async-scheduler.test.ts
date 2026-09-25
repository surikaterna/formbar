import { afterEach, expect, test, vi } from "vitest";
import { createForm } from "../create-form.js";
import { issueEmissionId } from "../issue-provenance.js";
import { ScopedAsyncScheduler } from "../scoped-async-scheduler.js";
import { type ScopedAsyncField, registerScopedAsync } from "../scoped-async.js";
import type { ValidationIssue } from "../state.js";

afterEach(() => vi.useRealTimers());

test.each(["onChange", "onBlur"] as const)(
	"two independent %s sibling timers retain original issues",
	async (trigger) => {
		vi.useFakeTimers();
		const form = createForm({ initialData: { rows: [{ value: "a" }, { value: "b" }] }, ownedScheduling: true });
		const calls: number[] = [];
		const fields: ScopedAsyncField[] = [0, 1].map((index) => ({
			id: "row",
			fieldId: "value",
			instanceKey: `row:${index}`,
			binding: { namespace: "data", segments: ["rows", index, "value"] },
			trigger,
			debounceMs: index ? 300 : 100,
			validate: async () => {
				calls.push(index);
				return [{ code: "bad", message: "bad", severity: "error" }];
			},
		}));
		registerScopedAsync(form, { ids: new Set(["row"]), instances: () => ({ current: () => true, fields }) }, []);
		let published: readonly ValidationIssue[] = [];
		const scheduler = new ScopedAsyncScheduler({
			form: () => form,
			revision: () => 0,
			publishIssues: (previous, issues) => {
				published = [...published.filter((issue) => !previous.has(issue)), ...issues];
			},
		});
		for (const index of [0, 1]) scheduler.onEvent({ namespace: "data", segments: ["rows", index, "value"] }, trigger);
		await vi.advanceTimersByTimeAsync(100);
		expect(calls).toEqual([0]);
		expect(published).toHaveLength(1);
		expect(issueEmissionId(published[0] as ValidationIssue)).toBeDefined();
		await vi.advanceTimersByTimeAsync(200);
		expect(calls).toEqual([0, 1]);
		expect(published).toHaveLength(2);
		expect(published.every((issue) => issueEmissionId(issue) !== undefined)).toBe(true);
		scheduler.reset(true);
		form.dispose();
	},
);
