import { describe, expect, it } from "vitest";
import { attemptCanSubmit, beginAttempt, clearAttempt, completeAttempt, renderableIssues } from "../attempt-issues.js";
import { createForm } from "../create-form.js";
import { issuesForPath } from "../path-relations.js";
import type { FormState, ValidationIssue } from "../state.js";
import { FormStore } from "../store.js";
import { createValidationCoordinator } from "../validation-coordinator.js";

const path = { namespace: "data" as const, segments: ["visible"] };
const issue = (
	origin: ValidationIssue["source"]["origin"],
	code: string,
	severity: ValidationIssue["severity"] = "error",
): ValidationIssue => ({
	code,
	message: code,
	severity,
	path,
	source: { origin, validatorId: code },
});
const draft = issue("function-validator", "hidden-draft");
const candidate = issue("function-validator", "visible-candidate");
const base = (): FormState<{ visible: string }, object> => ({
	data: { visible: "" },
	uiState: {},
	meta: { validation: {} },
	fieldMeta: {},
	fieldPolicy: [],
	issues: [draft],
});
const completed = (issues: readonly ValidationIssue[]) => ({ status: "completed" as const, issues });

describe("isolated attempt issue lane", () => {
	it("retains draft issues and surfaces only the latest failed candidate with stable path IDs", () => {
		const store = new FormStore(base());
		const snapshots: FormState<{ visible: string }, object>[] = [];
		store.subscribe((state) => snapshots.push(state));
		const update = (fn: (state: FormState<{ visible: string }, object>) => FormState<{ visible: string }, object>) => {
			const tx = store.beginTransaction();
			tx.mutate(fn);
			store.commitTransaction(tx);
		};
		update((state) => beginAttempt(state, "first", 1));
		update((state) => completeAttempt(state, "first", 1, completed([candidate])));
		expect(store.getState().issues).toEqual([draft]);
		expect(store.getState().attemptValidation).toMatchObject({ submitId: "first", revision: 1, status: "failed" });
		expect(renderableIssues(store.getState()).map((entry) => entry.code)).toEqual([
			"hidden-draft",
			"visible-candidate",
		]);
		expect(issuesForPath(renderableIssues(store.getState()), path).map((entry) => entry.code)).toEqual([
			"hidden-draft",
			"visible-candidate",
		]);
		update((state) => beginAttempt(state, "second", 2));
		expect(renderableIssues(store.getState())).toEqual([draft]);
		update((state) => completeAttempt(state, "first", 1, completed([candidate])));
		expect(store.getState().attemptValidation?.status).toBe("running");
		update((state) => completeAttempt(state, "second", 2, completed([issue("submit", "server")])));
		expect(renderableIssues(store.getState()).map((entry) => entry.code)).toEqual(["hidden-draft", "server"]);
		update(clearAttempt);
		expect(renderableIssues(store.getState())).toEqual([draft]);
		expect(snapshots).toHaveLength(6);
	});

	it("requires a verified candidate and blocks non-validator origins regardless of path", () => {
		const running = beginAttempt(base(), "id", 8);
		expect(attemptCanSubmit(running, 8)).toBe(false);
		const success = completeAttempt(running, "id", 8, completed([issue("async-validator", "hint", "warning")]));
		expect(attemptCanSubmit(success, 8)).toBe(true);
		expect(attemptCanSubmit(success, 9)).toBe(false);
		expect(renderableIssues(success)).toEqual([draft]);
		for (const origin of ["rule", "middleware", "submit"] as const) {
			expect(attemptCanSubmit({ ...success, issues: [draft, issue(origin, origin)] }, 8)).toBe(false);
		}
		const rootGate = { ...issue("middleware", "unowned-root"), path: { namespace: "data" as const, segments: [] } };
		expect(attemptCanSubmit({ ...success, issues: [draft, rootGate] }, 8)).toBe(false);
		expect(attemptCanSubmit({ ...success, issues: [draft, issue("middleware", "warn", "warning")] }, 8)).toBe(true);
		const failed = completeAttempt(running, "id", 8, completed([candidate, issue("middleware", "gate")]));
		expect(attemptCanSubmit(failed, 8)).toBe(false);
		expect(failed.issues).toEqual([draft]);
		expect(renderableIssues(failed)).toHaveLength(3);
		expect(completeAttempt(running, "id", 8, { status: "aborted", issues: [] }).attemptValidation).toBeUndefined();
	});

	it("combines synchronous and isolated asynchronous candidate results without publishing into draft", async () => {
		let state = base();
		const coordinator = createValidationCoordinator({
			validators: [{ id: "remote", validate: async () => [issue("async-validator", "remote")] }],
			getState: () => state,
			updateState: (updater) => {
				state = updater(state);
			},
		});
		state = beginAttempt(state, "candidate", coordinator.revision());
		const result = await coordinator.validateCandidate(
			{ data: state.data, uiState: state.uiState },
			coordinator.revision(),
		);
		state = completeAttempt(state, "candidate", coordinator.revision(), result, [candidate]);
		expect(state.issues).toEqual([draft]);
		expect(state.attemptValidation?.issues.map((entry) => entry.code)).toEqual(["remote", "visible-candidate"]);
		expect(state.attemptValidation?.status).toBe("failed");
		coordinator.dispose();
	});

	it("leaves default submit, isValid, field errors and metadata unchanged", async () => {
		const form = createForm({
			initialData: { visible: "" },
			onSubmit: async () => ({ ok: false, submitId: "server", fieldErrors: { visible: "Taken" } }),
		});
		expect(form.getState().attemptValidation).toBeUndefined();
		await form.submit();
		expect(form.getState().attemptValidation).toBeUndefined();
		expect(form.getState().issues.map((entry) => entry.message)).toEqual(["Taken"]);
		expect(form.fieldDynamic("visible").issues()).toEqual([]);
		expect(form.isValid()).toBe(false);
		expect(form.canSubmit()).toBe(false);
		form.reset();
		expect(form.getState().issues).toEqual([]);
		form.dispose();
	});
});
