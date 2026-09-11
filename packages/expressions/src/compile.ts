import type { Expression, JsonValue, Scopes, StateRef } from "./contracts.js";
import { LIMITS, copyJson, safeName } from "./json.js";
import { dependencyKey, parseRef, resolveRef } from "./references.js";
import { ExpressionError } from "./result.js";
import { exactKeys, isJsonArray, jsonRecord } from "./shape.js";

export function validateExpression(input: unknown, scopes: Scopes = {}): Expression {
	return visit(copyJson(input), scopes);
}

function visit(input: JsonValue, scopes: Scopes): Expression {
	const node = jsonRecord(input);
	if (node.kind === "literal") {
		exactKeys(node, ["kind", "value"]);
		if (!("value" in node)) throw new ExpressionError("invalid-input");
		return Object.freeze({ kind: "literal", value: node.value });
	}
	if (node.kind === "ref") {
		exactKeys(node, ["kind", "ref"]);
		if (!Object.hasOwn(node, "ref")) throw new ExpressionError("invalid-input");
		return Object.freeze({ kind: "ref", ref: resolveRef(parseRef(node.ref), scopes) });
	}
	if (node.kind !== "op" || !safeName(node.op) || !Object.hasOwn(node, "args") || !isJsonArray(node.args))
		throw new ExpressionError("invalid-input");
	exactKeys(node, ["kind", "op", "args"]);
	if (node.args.length > LIMITS.args) throw new ExpressionError("limit");
	return Object.freeze({ kind: "op", op: node.op, args: Object.freeze(node.args.map((arg) => visit(arg, scopes))) });
}

export function collectDependencies(expression: Expression): readonly StateRef[] {
	const refs = new Map<string, StateRef>();
	const walk = (node: Expression): void => {
		if (node.kind === "ref") refs.set(dependencyKey(node.ref), node.ref);
		if (node.kind === "op") node.args.forEach(walk);
	};
	walk(expression);
	return Object.freeze([...refs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, ref]) => ref));
}
