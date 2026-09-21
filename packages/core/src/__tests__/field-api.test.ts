import { describe, expect, it } from "vitest";
import type { ValidatorFn } from "../contracts.js";
import { createFieldApi } from "../field-api.js";
import type { CanonicalPath } from "../path.js";
import type { FormState, ValidationIssue } from "../state.js";

function makePath(segments: readonly string[]): CanonicalPath {
	return { namespace: "data", segments, canonical: segments.join(".") };
}

function makeState(overrides?: Partial<FormState>): FormState {
	return {
		data: overrides?.data ?? {},
		uiState: overrides?.uiState ?? {},
		meta: overrides?.meta ?? { validation: {} },
		fieldMeta: overrides?.fieldMeta ?? {},
		fieldPolicy: overrides?.fieldPolicy ?? [],
		issues: overrides?.issues ?? [],
	};
}

function makeValidator(_id: string, issues: readonly ValidationIssue[]): ValidatorFn {
	return () => issues;
}

function makeSpyValidator(
	_id: string,
	issues: readonly ValidationIssue[],
): ValidatorFn & { readonly calls: Array<Record<string, unknown>> } {
	const calls: Array<Record<string, unknown>> = [];
	const fn = ((input: Record<string, unknown>) => {
		calls.push({ ...input });
		return issues;
	}) as ValidatorFn & { readonly calls: Array<Record<string, unknown>> };
	Object.defineProperty(fn, "calls", { value: calls });
	return fn;
}

describe("FieldApi.validate()", () => {
	it("returns empty array when no validators configured", () => {
		const api = createFieldApi({
			path: makePath(["name"]),
			rawPath: "name",
			getState: () => makeState(),
			setValue: () => ({ ok: true }),
			getIssues: () => [],
			getInitialValue: () => undefined,
			getFieldMeta: () => undefined,
			markTouched: () => {},
			getFormSubmitted: () => false,
			updateFieldMeta: () => {},
		});
		expect(api.validate()).toEqual([]);
	});

	it("invokes configured validators and returns their issues", () => {
		const issue: ValidationIssue = {
			path: "name",
			code: "required",
			message: "Name is required",
		};
		const api = createFieldApi({
			path: makePath(["name"]),
			rawPath: "name",
			getState: () => makeState(),
			setValue: () => ({ ok: true }),
			getIssues: () => [],
			getInitialValue: () => undefined,
			getFieldMeta: () => undefined,
			markTouched: () => {},
			getFormSubmitted: () => false,
			updateFieldMeta: () => {},
			config: { validators: [makeValidator("v1", [issue])] },
		});
		expect(api.validate()).toEqual([issue]);
	});

	it("merges issues from multiple validators", () => {
		const issue1: ValidationIssue = {
			path: "name",
			code: "required",
			message: "Required",
		};
		const issue2: ValidationIssue = {
			path: "name",
			code: "minLength",
			message: "Too short",
		};
		const api = createFieldApi({
			path: makePath(["name"]),
			rawPath: "name",
			getState: () => makeState(),
			setValue: () => ({ ok: true }),
			getIssues: () => [],
			getInitialValue: () => undefined,
			getFieldMeta: () => undefined,
			markTouched: () => {},
			getFormSubmitted: () => false,
			updateFieldMeta: () => {},
			config: {
				validators: [makeValidator("v1", [issue1]), makeValidator("v2", [issue2])],
			},
		});
		expect(api.validate()).toEqual([issue1, issue2]);
	});

	it("passes correct data and uiState to validators", () => {
		const spy = makeSpyValidator("spy", []);
		const data = { name: "Alice" };
		const uiState = { focused: true };
		const api = createFieldApi({
			path: makePath(["name"]),
			rawPath: "name",
			getState: () => makeState({ data, uiState }),
			setValue: () => ({ ok: true }),
			getIssues: () => [],
			getInitialValue: () => undefined,
			getFieldMeta: () => undefined,
			markTouched: () => {},
			getFormSubmitted: () => false,
			updateFieldMeta: () => {},
			config: { validators: [spy] },
		});
		api.validate();
		expect(spy.calls).toHaveLength(1);
		expect(spy.calls[0]).toEqual({ data, uiState });
	});

	it("passes stage from meta if available", () => {
		const spy = makeSpyValidator("spy", []);
		const api = createFieldApi({
			path: makePath(["name"]),
			rawPath: "name",
			getState: () => makeState({ meta: { stage: "draft", validation: {} } }),
			setValue: () => ({ ok: true }),
			getIssues: () => [],
			getInitialValue: () => undefined,
			getFieldMeta: () => undefined,
			markTouched: () => {},
			getFormSubmitted: () => false,
			updateFieldMeta: () => {},
			config: { validators: [spy] },
		});
		api.validate();
		expect(spy.calls).toHaveLength(1);
		expect(spy.calls[0]).toEqual({
			data: {},
			uiState: {},
			stage: "draft",
		});
	});
});

describe("FieldApi.handleChange()", () => {
	it("sets the field value (same as set())", () => {
		let lastSetValue: unknown;
		const api = createFieldApi({
			path: makePath(["name"]),
			rawPath: "name",
			getState: () => makeState(),
			setValue: (_path, value) => {
				lastSetValue = value;
				return { ok: true };
			},
			getIssues: () => [],
			getInitialValue: () => undefined,
			getFieldMeta: () => undefined,
			markTouched: () => {},
			getFormSubmitted: () => false,
			updateFieldMeta: () => {},
		});
		const result = api.handleChange("Alice");
		expect(result).toEqual({ ok: true });
		expect(lastSetValue).toBe("Alice");
	});
});

describe("FieldApi.handleBlur()", () => {
	it("marks field as touched", () => {
		let touchedPath: string | undefined;
		const api = createFieldApi({
			path: makePath(["name"]),
			rawPath: "name",
			getState: () => makeState(),
			setValue: () => ({ ok: true }),
			getIssues: () => [],
			getInitialValue: () => undefined,
			getFieldMeta: () => undefined,
			markTouched: (p) => {
				touchedPath = p;
			},
			getFormSubmitted: () => false,
			updateFieldMeta: () => {},
		});
		api.handleBlur();
		expect(touchedPath).toBe("name");
	});

	it("is idempotent on already-touched field", () => {
		let touchCount = 0;
		const api = createFieldApi({
			path: makePath(["name"]),
			rawPath: "name",
			getState: () => makeState(),
			setValue: () => ({ ok: true }),
			getIssues: () => [],
			getInitialValue: () => undefined,
			getFieldMeta: () => ({ touched: true }),
			markTouched: () => {
				touchCount++;
			},
			getFormSubmitted: () => false,
			updateFieldMeta: () => {},
		});
		api.handleBlur();
		api.handleBlur();
		// markTouched is called but the field was already touched — no error thrown
		expect(touchCount).toBe(2);
	});
});
