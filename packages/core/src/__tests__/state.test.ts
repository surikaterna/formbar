import { describe, expect, test } from "vitest";
import type { CreateFormOptions, ExprNode, FormState, ValidationIssue } from "../index.js";

describe("FormState shape", () => {
	test("default state has optional stage", () => {
		const state: FormState = {
			data: {},
			uiState: {},
			meta: {
				validation: {},
			},
			fieldMeta: {},
			fieldPolicy: [],
			issues: [],
		};
		expect(state.meta.stage).toBeUndefined();
	});

	test("state with stage set", () => {
		const state: FormState = {
			data: null,
			uiState: null,
			meta: {
				stage: "new",
				validation: {},
			},
			fieldMeta: {},
			fieldPolicy: [],
			issues: [],
		};
		expect(state.meta.stage).toBe("new");
	});

	test("meta.submission fields are optional", () => {
		const state: FormState = {
			data: {},
			uiState: {},
			meta: {
				stage: "draft",
				validation: {},
				submission: {
					status: "idle",
				},
			},
			fieldMeta: {},
			fieldPolicy: [],
			issues: [],
		};
		expect(state.meta.submission?.status).toBe("idle");
	});

	test("issues array contains ValidationIssue", () => {
		const issue: ValidationIssue = {
			code: "REQUIRED",
			message: "Field is required",
			severity: "error",
			stage: "submit",
			path: { namespace: "data", segments: ["name"] },
			source: { origin: "function-validator", validatorId: "required-check" },
		};
		const state: FormState = {
			data: {},
			uiState: {},
			meta: { stage: "draft", validation: {} },
			fieldMeta: {},
			fieldPolicy: [],
			issues: [issue],
		};
		expect(state.issues).toHaveLength(1);
		expect(state.issues[0].code).toBe("REQUIRED");
	});
});

describe("CreateFormOptions", () => {
	test("schema is optional", () => {
		const opts: CreateFormOptions = {};
		expect(opts.schema).toBeUndefined();
	});

	test("accepts full options", () => {
		const opts: CreateFormOptions = {
			schema: {},
			initialData: { name: "" },
			initialUiState: { visible: true },
		};
		expect(opts.schema).toBeDefined();
	});
});

describe("ExprNode discriminated union", () => {
	test("literal node", () => {
		const node: ExprNode = { kind: "literal", value: 42 };
		expect(node.kind).toBe("literal");
	});

	test("path node", () => {
		const node: ExprNode = { kind: "path", path: "customer.email" };
		expect(node.kind).toBe("path");
	});

	test("op node", () => {
		const node: ExprNode = {
			kind: "op",
			op: "$eq",
			args: [
				{ kind: "path", path: "status" },
				{ kind: "literal", value: "active" },
			],
		};
		expect(node.kind).toBe("op");
	});
});
