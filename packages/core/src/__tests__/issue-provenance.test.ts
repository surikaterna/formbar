import { describe, expect, test } from "vitest";
import { completeAttempt, rebaseAttemptIssues } from "../attempt-issues.js";
import { createIssueEmission, issueCertificate } from "../issue-provenance.js";
import type { FormState, ValidationIssue } from "../state.js";
import { normalizeIssues } from "../validation.js";

function fixture(segments: readonly (string | number)[] = ["private"]) {
	let revision = 1;
	let active = true;
	const run = {};
	const controller = new AbortController();
	const emit = createIssueEmission({
		fieldId: "field",
		instanceKey: "outer:0/inner:1/field",
		binding: { namespace: "data", segments },
		revision,
		run,
		signal: controller.signal,
		current: () => active && revision === 1,
	});
	return {
		emit,
		run,
		controller,
		setRevision: (value: number) => {
			revision = value;
		},
		deactivate: () => {
			active = false;
		},
	};
}

const proposed = { code: "E", message: "identical", severity: "error" as const };

function unowned(certified: ValidationIssue): ValidationIssue {
	return {
		...certified,
		path: { ...certified.path, segments: [...certified.path.segments] },
		source: { ...certified.source },
	};
}

describe("private issue production (#262)", () => {
	test.each(["certified first", "unowned first"])(
		"retains bit-identical owned and unowned diagnostics: %s",
		(order) => {
			const host = fixture();
			const certified = host.emit(proposed);
			const other = unowned(certified);
			const issues = order === "certified first" ? [certified, other] : [other, certified];
			const normalized = normalizeIssues(issues);
			expect(normalized).toHaveLength(2);
			expect(issueCertificate(certified, 1, host.run)).toBeDefined();
			expect(issueCertificate(other, 1, host.run)).toBeUndefined();
			expect(normalized.filter((entry) => issueCertificate(entry, 1, host.run))).toEqual([certified]);
			expect(normalizeIssues([other, unowned(certified)])).toHaveLength(1);
		},
	);

	test.each([
		[["a.b"], ["a", "b"]],
		[["0"], [0]],
		[
			["outer", 0, "inner", 1, "value"],
			["outer", 1, "inner", 0, "value"],
		],
	] as const)("separates typed concrete binding %j from %j", (left, right) => {
		const host = fixture(left);
		const certified = host.emit(proposed);
		const collision = unowned(certified);
		const second = fixture(right).emit(proposed);
		expect(normalizeIssues([certified, collision, second])).toHaveLength(3);
		expect(certified.path.segments).toEqual(left);
		expect(second.path.segments).toEqual(right);
		expect(issueCertificate(certified, 1, host.run)?.binding).toEqual(left);
		expect(issueCertificate(second, 1, host.run)).toBeUndefined();
	});

	test("rejects unsafe paths and ignores caller provenance assertions", () => {
		const host = fixture();
		expect(() => host.emit({ ...proposed, descendant: ["__proto__"] })).toThrow();
		const issue = host.emit({ ...proposed, descendant: ["deep", 0] });
		expect(issue.path.segments).toEqual(["private", "deep", 0]);
		expect(issueCertificate({ ...issue, details: { certified: true } }, 1, host.run)).toBeUndefined();
		expect(
			issueCertificate({ ...issue, details: { origin: "claimed", fieldId: "field" } }, 1, host.run),
		).toBeUndefined();
		expect(issueCertificate(issue, 1, {})).toBeUndefined();
		expect(issueCertificate(issue, 2, host.run)).toBeUndefined();
	});

	test.each(["revision", "dispose", "abort"])("invalidates on %s without certifying a successor", (kind) => {
		const host = fixture();
		const old = host.emit(proposed);
		if (kind === "revision") host.setRevision(2);
		if (kind === "dispose") host.deactivate();
		if (kind === "abort") host.controller.abort();
		expect(issueCertificate(old, 1, host.run)).toBeUndefined();
		expect(() => host.emit(proposed)).toThrow();
		const successor = fixture().emit(proposed);
		expect(issueCertificate(successor, 1, host.run)).toBeUndefined();
	});

	test("async supersession and sync replacement never transfer a prior emission", async () => {
		const first = fixture(["rows", 0, "value"]);
		const old = first.emit(proposed);
		let release!: () => void;
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		const late = pending.then(() => first.emit(proposed));
		first.deactivate();
		const second = fixture(["rows", 1, "value"]);
		const replacement = second.emit(proposed);
		release();
		await expect(late).rejects.toThrow("stale");
		expect(issueCertificate(old, 1, first.run)).toBeUndefined();
		expect(normalizeIssues([old, replacement])).toHaveLength(2);
		expect(issueCertificate(replacement, 1, second.run)).toBeDefined();
	});

	test("retains identity through failed attempt rebase and candidate normalization", () => {
		const host = fixture();
		const certified = host.emit(proposed);
		const other = unowned(certified);
		const base: FormState<object, object> = {
			data: {},
			uiState: {},
			meta: { validation: {} },
			fieldMeta: {},
			fieldPolicy: [],
			issues: normalizeIssues([certified, other]),
			attemptValidation: { submitId: "s", revision: 1, status: "running", issues: [], renderableIssues: [] },
		};
		const completed = completeAttempt(base, "s", 1, { status: "completed", issues: [other] });
		const rebased = rebaseAttemptIssues(completed);
		expect(rebased.attemptValidation?.renderableIssues).toHaveLength(3);
		expect(rebased.issues.filter((entry) => issueCertificate(entry, 1, host.run))).toEqual([certified]);
		expect(completeAttempt(base, "other", 1, { status: "completed", issues: [] })).toBe(base);
		host.setRevision(2);
		expect(issueCertificate(rebased.issues[0], 1, host.run)).toBeUndefined();
	});
});
