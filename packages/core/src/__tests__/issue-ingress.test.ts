import { describe, expect, test, vi } from "vitest";
import { createForm } from "../create-form.js";
import { createIssueEmission, issueEmissionId } from "../issue-provenance.js";
import type { ValidationIssue } from "../state.js";
import { FormStore, publishIssueOnly } from "../store.js";

function issue(): ValidationIssue {
	return {
		code: "invalid",
		message: "wrong",
		severity: "error",
		path: { namespace: "data", segments: ["a.b", 0] },
		source: { origin: "function-validator", validatorId: "v" },
		details: { nested: [{ value: 1 }] },
	};
}

function store(issues: ValidationIssue[] = []) {
	return new FormStore({
		data: { x: 1 },
		uiState: {},
		meta: { validation: {} },
		fieldMeta: {},
		fieldPolicy: [],
		issues,
	});
}

describe("unified issue ingress", () => {
	test("detaches nested ordinary diagnostics at construction, commit and issue-only publication", () => {
		const incoming = issue();
		const s = store([incoming]);
		const first = s.getState();
		expect(first.issues[0]).not.toBe(incoming);
		expect(Object.isFrozen(first.issues[0]?.details?.nested)).toBe(true);
		const next = issue();
		const tx = s.beginTransaction();
		tx.mutate((draft) => ({ ...draft, issues: [next] }));
		s.commitTransaction(tx);
		const current = s.getState().issues[0] as ValidationIssue;
		expect(current).not.toBe(next);
		(next.details?.nested as { value: number }[])[0] = { value: 2 };
		(incoming.details?.nested as { value: number }[])[0] = { value: 3 };
		expect((current.details?.nested as { value: number }[])[0]?.value).toBe(1);
		expect((first.issues[0]?.details?.nested as { value: number }[])[0]?.value).toBe(1);
		publishIssueOnly(s, [current]);
		expect(s.getState().issues[0]).toBe(current);
		expect(Object.isFrozen(next)).toBe(false);
	});

	test("a private scoped emission survives a default transaction but identical public copies do not", () => {
		const scoped = createIssueEmission({
			fieldId: "v",
			instanceKey: "i",
			binding: { namespace: "data", segments: ["a.b", 0] },
			revision: 1,
			run: {},
			current: () => true,
		})({ code: "invalid", message: "wrong", severity: "error" });
		const copy = { ...scoped };
		const s = store([scoped, copy]);
		const tx = s.beginTransaction();
		tx.mutate((draft) => ({ ...draft, meta: { validation: { validating: true } } }));
		s.commitTransaction(tx);
		expect(s.getState().issues).toHaveLength(2);
		expect(s.getState().issues).toContain(scoped);
		expect(issueEmissionId(scoped)).toBeTypeOf("number");
		expect(issueEmissionId(s.getState().issues.find((entry) => entry !== scoped) as ValidationIssue)).toBeUndefined();
	});

	test("retained, failed-attempt and renderable issues share owned identities across rebase", () => {
		const retained = issue();
		const candidate = issue();
		const s = new FormStore({
			...store().getState(),
			issues: [retained],
			attemptValidation: {
				submitId: "s",
				revision: 1,
				status: "failed" as const,
				issues: [candidate],
				renderableIssues: [retained, candidate],
			},
		});
		const first = s.getState();
		const ownedCandidate = first.attemptValidation?.issues[0];
		expect(first.attemptValidation?.renderableIssues).toEqual([first.issues[0], ownedCandidate]);
		const tx = s.beginTransaction();
		tx.mutate((draft) => ({ ...draft, meta: { validation: { validating: true } } }));
		s.commitTransaction(tx);
		expect(s.getState().attemptValidation?.issues[0]).toBe(ownedCandidate);
		expect(s.getState().attemptValidation?.renderableIssues[0]).toBe(first.issues[0]);
		(candidate.details?.nested as { value: number }[])[0] = { value: 9 };
		expect((s.getState().attemptValidation?.issues[0]?.details?.nested as { value: number }[])[0]?.value).toBe(1);
	});

	test.each([
		() => ({ ...issue(), [Symbol("hidden")]: 1 }),
		() => ({
			...issue(),
			details: {
				get secret() {
					return 1;
				},
			},
		}),
		() => ({ ...issue(), details: { children: new Array(2) } }),
		() => {
			const value: { self?: unknown } = {};
			value.self = value;
			return { ...issue(), details: value };
		},
		() => ({ ...issue(), path: { namespace: "data", segments: ["a", Symbol("b")] } }),
		() => ({ ...issue(), details: Object.defineProperty({}, "__proto__", { enumerable: true, value: 1 }) }),
	])("rejects unsupported issue graphs atomically and recovers", (make) => {
		const s = store();
		const prior = s.getState();
		const listener = vi.fn();
		s.subscribe(listener);
		const malformed = make() as ValidationIssue;
		const tx = s.beginTransaction();
		tx.mutate((draft) => ({ ...draft, issues: [malformed] }));
		expect(() => s.commitTransaction(tx)).toThrow("ISSUE_ONLY_UNSUPPORTED_STATE");
		expect(s.getState()).toBe(prior);
		expect(listener).not.toHaveBeenCalled();
		s.rollbackTransaction(tx);
		publishIssueOnly(s, [issue()]);
		expect(listener).toHaveBeenCalledTimes(1);
	});

	test("foreground async rejection is code-only and a later run recovers without lost issues", async () => {
		let malformed = true;
		const form = createForm({
			initialData: { x: 1 },
			asyncValidators: [
				{
					id: "v",
					label: "v",
					validate: async () => [malformed ? { ...issue(), details: { value: Symbol("bad") } } : issue()],
				},
			],
		});
		const before = form.getState();
		await expect(form.validateAsync()).rejects.toThrow("ISSUE_ONLY_UNSUPPORTED_STATE");
		expect(form.getState().issues).toEqual(before.issues);
		expect(form.getState().meta.validation.validating).toBe(false);
		malformed = false;
		expect((await form.validateAsync()).status).toBe("completed");
		expect(form.getState().issues).toHaveLength(1);
		form.dispose();
	});
});
