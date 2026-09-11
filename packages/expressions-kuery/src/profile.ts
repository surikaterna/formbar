import { ExpressionError } from "@formbar/expressions";
import { OperatorRegistry } from "kuery";

export const operators: Readonly<Record<string, string>> = Object.freeze({
	eq: "$eq",
	neq: "$ne",
	gt: "$gt",
	gte: "$gte",
	lt: "$lt",
	lte: "$lte",
	and: "$and",
	or: "$or",
	not: "$not",
	in: "$in",
	nin: "$nin",
	add: "$formbarAdd",
	subtract: "$formbarSubtract",
	multiply: "$formbarMultiply",
	divide: "$formbarDivide",
});
const arithmetic = new Set(["add", "subtract", "multiply", "divide"]);
const logical = new Set(["and", "or", "not"]);
const ordered = new Set(["gt", "gte", "lt", "lte"]);

export const resultWitness = (op: string): number | boolean => (arithmetic.has(op) ? 0 : false);

export function validateArity(op: string, length: number): void {
	if (!Object.hasOwn(operators, op)) throw new ExpressionError("unsupported-operator");
	const variadic = op === "and" || op === "or";
	if (variadic ? length < 1 : length !== (op === "not" ? 1 : 2)) throw new ExpressionError("arity");
}

export function validateTypes(op: string, args: readonly unknown[]): void {
	const known = args.filter((arg) => arg !== undefined);
	if (arithmetic.has(op) && known.some((arg) => typeof arg !== "number")) throw new ExpressionError("type");
	if (logical.has(op) && known.some((arg) => typeof arg !== "boolean")) throw new ExpressionError("type");
	if ((op === "in" || op === "nin") && args[1] !== undefined && !Array.isArray(args[1]))
		throw new ExpressionError("type");
	if (!ordered.has(op)) return;
	if (known.some((arg) => typeof arg !== "number" && typeof arg !== "string")) throw new ExpressionError("type");
	if (known.length === 2 && typeof known[0] !== typeof known[1]) throw new ExpressionError("type");
}

function calculate(op: string, args: readonly unknown[]): number {
	validateTypes(op, args);
	const [a, b] = args as readonly number[];
	if (!Number.isFinite(a) || !Number.isFinite(b)) throw new ExpressionError("non-finite");
	if (op === "divide" && b === 0) throw new ExpressionError("division-zero");
	const value = op === "add" ? a + b : op === "subtract" ? a - b : op === "multiply" ? a * b : a / b;
	if (!Number.isFinite(value)) throw new ExpressionError("non-finite");
	return value;
}

export function createProfileRegistry(): OperatorRegistry {
	const registry = new OperatorRegistry();
	for (const op of arithmetic) registry.register({ name: operators[op], arity: 2 }, (args) => calculate(op, args));
	return registry;
}
