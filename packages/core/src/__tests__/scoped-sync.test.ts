import { describe, expect, it } from "vitest";
import * as publicCore from "../index.js";
import { createDeferredForm, createForm } from "../index.js";
import { registerScopedSync } from "../internal/scoped-sync.js";
import { issueCertificate, issueEmissionId } from "../issue-provenance.js";
import { normalizeIssues } from "../validation.js";

describe("internal trusted scoped sync adapter", () => {
	it("does not offer raw registration through the public core root", () => {
		expect(publicCore).not.toHaveProperty("registerScopedSync");
		const bare = createForm({ initialData: { x: "a" } });
		expect(bare.validate()).toEqual([]);
	});
	it("keeps the original stamped issue separate from identical generic diagnostics", () => {
		const plain = {
			code: "bad",
			message: "bad",
			severity: "error" as const,
			path: { namespace: "data" as const, segments: ["x"] },
			source: { origin: "function-validator" as const, validatorId: "field" },
		};
		const form = createForm({ initialData: { x: "a" }, validators: [() => [plain]] });
		registerScopedSync(form, {
			instances: (_form, capture) => ({
				current: () => form.captureState().state === capture.state,
				fields: [
					{
						fieldId: "field",
						instanceKey: "field",
						binding: { namespace: "data", segments: ["x"] },
						validate: () => [{ code: "bad", message: "bad", severity: "error" }],
					},
				],
			}),
		});
		const [unowned, owned] = form.validate();
		if (!unowned || !owned) throw new Error("Missing issue");
		expect(normalizeIssues([owned, unowned])).toHaveLength(2);
		expect(issueEmissionId(normalizeIssues([owned])[0] as typeof owned)).toBeTypeOf("number");
		expect(issueEmissionId({ ...owned })).toBeUndefined();
		expect(normalizeIssues([unowned, owned])).toHaveLength(2);
		expect(issueCertificate(owned, 1, {})).toBeUndefined();
		expect(issueCertificate({ ...owned }, 1, {})).toBeUndefined();
		expect(issueCertificate(unowned, 1, {})).toBeUndefined();
		expect(() => registerScopedSync(form, { instances: () => ({ current: () => true, fields: [] }) })).toThrow();
		form.setValue("x", "b");
		expect(normalizeIssues([owned, unowned])).toHaveLength(1);
	});

	it("rejects unsafe diagnostics and stale reentrant callbacks", () => {
		const form = createForm({ initialData: { x: { child: "a" } } });
		registerScopedSync(form, {
			instances: () => ({
				current: () => true,
				fields: [
					{
						fieldId: "x",
						instanceKey: "x",
						binding: { namespace: "data", segments: ["x"] },
						validate: () => [{ code: "bad", message: "bad", severity: "error", descendant: ["missing"] }],
					},
				],
			}),
		});
		expect(() => form.validate()).toThrow("Invalid scoped field issue");
		const plain = createForm({ initialData: { x: "a" } });
		expect(plain.validate()).toEqual([]);
	});

	it("revokes deferred emissions on deactivation even if the state stays identical", () => {
		const runtime = createDeferredForm({ initialData: { x: "a" } });
		registerScopedSync(runtime.form, {
			instances: () => ({
				current: () => true,
				fields: [
					{
						fieldId: "x",
						instanceKey: "x",
						binding: { namespace: "data", segments: ["x"] },
						validate: () => [{ code: "bad", message: "bad", severity: "error" }],
					},
				],
			}),
		});
		runtime.activate();
		const state = runtime.form.getState();
		const [issue] = runtime.form.validate();
		if (!issue) throw new Error("Missing scoped issue");
		expect(issueEmissionId(issue)).toBeTypeOf("number");
		runtime.deactivate();
		expect(runtime.form.getState()).toBe(state);
		expect(issueEmissionId(issue)).toBeUndefined();
	});

	it("keeps typed relative descendants within a bound data subtree", () => {
		const form = createForm({ initialData: { obj: { "0": ["a"] } }, initialUiState: { obj: "ui" } });
		registerScopedSync(form, {
			instances: () => ({
				current: () => true,
				fields: [
					{
						fieldId: "obj",
						instanceKey: "obj",
						binding: { namespace: "data", segments: ["obj"] },
						validate: () => [{ code: "child", message: "child", severity: "warning", descendant: ["0", 0] }],
					},
				],
			}),
		});
		const [issue] = form.validate("draft");
		expect(issue).toMatchObject({ stage: "draft", path: { namespace: "data", segments: ["obj", "0", 0] } });
		expect(issue && issueEmissionId(issue)).toBeTypeOf("number");
	});
});
