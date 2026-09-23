import { standardV1 } from "kuery/expression";
import type { ExpressionProfile, JsonValue, ValueExpression } from "kuery/expression";
import type { DiagnosticCode, StateRef, SumByPath } from "./contracts.js";
import { LIMITS, safeName } from "./json.js";
import { ExpressionError } from "./result.js";

const BACKEND_SUM_BY = "formbar:sum-by";
type SumByFailure = Extract<DiagnosticCode, "invalid-input" | "limit" | "missing" | "type" | "non-finite">;
type FailureReporter = (code: SumByFailure) => void;

class SumByOperatorError extends Error {}

export function createDefaultExpressionProfile(report: FailureReporter): ExpressionProfile {
	return standardV1.extend("formbar-default-v1", [
		{
			name: BACKEND_SUM_BY,
			arity: 2,
			inputTypes: ["array", "array"],
			resultType: "number",
			execute: (args) => executeSumBy(args, report),
		},
	]);
}

export function prepareDefaultExpression(input: JsonValue): JsonValue {
	if (!isOperation(input)) return input;
	if (input.op === BACKEND_SUM_BY) throw new ExpressionError("invalid-input");
	const args = input.args.map(prepareDefaultExpression);
	if (input.op !== "sumBy") return Object.freeze({ ...input, args: Object.freeze(args) });
	if (args.length === 2) validateLiteralPath(args[1]);
	return Object.freeze({ ...input, op: BACKEND_SUM_BY, args: Object.freeze(args) });
}

export function restoreDefaultExpression(expression: ValueExpression<StateRef>): ValueExpression<StateRef> {
	if (expression.kind !== "op") return expression;
	const args = expression.args.map(restoreDefaultExpression);
	return Object.freeze({
		kind: "op",
		op: expression.op === BACKEND_SUM_BY ? "sumBy" : expression.op,
		args: Object.freeze(args),
	});
}

function isOperation(input: JsonValue): input is Extract<ValueExpression<StateRef>, { kind: "op" }> {
	return isRecord(input) && input.kind === "op" && Array.isArray(input.args);
}

function validateLiteralPath(input: JsonValue): void {
	if (!isRecord(input) || input.kind !== "literal" || !Array.isArray(input.value)) {
		throw new ExpressionError("invalid-input");
	}
	if (input.value.length > LIMITS.segments) throw new ExpressionError("limit");
	if (!input.value.every(isPathSegment)) throw new ExpressionError("invalid-input");
}

function isRecord(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPathSegment(value: JsonValue): value is SumByPath[number] {
	return typeof value === "number" ? Number.isSafeInteger(value) && value >= 0 : safeName(value);
}

function executeSumBy(args: readonly JsonValue[], report: FailureReporter): number {
	try {
		const collection = inspectArray(args[0], report);
		const path = inspectArray(args[1], report);
		return sumCollection(collection, path, report);
	} catch (error) {
		if (error instanceof SumByOperatorError) throw error;
		return fail(report, "invalid-input");
	}
}

function sumCollection(collection: readonly JsonValue[], path: readonly JsonValue[], report: FailureReporter): number {
	if (collection.length > LIMITS.nodes || path.length > LIMITS.segments) return fail(report, "limit");
	if (!path.every(isPathSegment)) return fail(report, "invalid-input");
	const work = { remaining: LIMITS.nodes };
	let total = 0;
	for (const item of collection) {
		consumeWork(work, report);
		const value = readPath(item, path as SumByPath, work, report);
		if (typeof value !== "number") return fail(report, "type");
		if (!Number.isFinite(value)) return fail(report, "non-finite");
		total += value;
		if (!Number.isFinite(total)) return fail(report, "non-finite");
	}
	return total === 0 ? 0 : total;
}

function readPath(item: JsonValue, path: SumByPath, work: { remaining: number }, report: FailureReporter): JsonValue {
	let current = item;
	for (const segment of path) {
		consumeWork(work, report);
		if (current === null || typeof current !== "object") return fail(report, "missing");
		if (!isJsonContainer(current)) return fail(report, "invalid-input");
		const descriptor = Object.getOwnPropertyDescriptor(current, segment);
		if (!descriptor) return fail(report, "missing");
		if (!descriptor.enumerable || !("value" in descriptor)) return fail(report, "invalid-input");
		current = descriptor.value;
	}
	return current;
}

function inspectArray(value: JsonValue | undefined, report: FailureReporter): readonly JsonValue[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return fail(report, "invalid-input");
	const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
	if (!Number.isSafeInteger(length) || length < 0 || length > LIMITS.nodes) return fail(report, "limit");
	if (Reflect.ownKeys(value).length !== length + 1) return fail(report, "invalid-input");
	const output: JsonValue[] = [];
	for (let index = 0; index < length; index++) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !("value" in descriptor)) return fail(report, "invalid-input");
		output.push(descriptor.value);
	}
	return output;
}

function isJsonContainer(value: object): boolean {
	const prototype = Object.getPrototypeOf(value);
	return Array.isArray(value) ? prototype === Array.prototype : prototype === Object.prototype || prototype === null;
}

function consumeWork(work: { remaining: number }, report: FailureReporter): void {
	if (work.remaining-- <= 0) fail(report, "limit");
}

function fail(report: FailureReporter, code: SumByFailure): never {
	report(code);
	throw new SumByOperatorError(code);
}
