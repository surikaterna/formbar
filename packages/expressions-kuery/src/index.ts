import { ExpressionError, failure, validateExpression } from "@formbar/expressions";
import type { Expression, ExpressionBackend, JsonValue, StateRef } from "@formbar/expressions";
import { evaluate } from "kuery";
import type { ExprNode, OperatorRegistry } from "kuery";
import { createProfileRegistry, operators, resultWitness, validateArity, validateTypes } from "./profile.js";

function validate(node: Expression): unknown {
	if (node.kind === "literal") return node.value;
	if (node.kind === "ref") return undefined;
	validateArity(node.op, node.args.length);
	validateTypes(node.op, node.args.map(validate));
	return resultWitness(node.op);
}

function execute(node: Expression, read: (ref: StateRef) => JsonValue, registry: OperatorRegistry): unknown {
	if (node.kind === "literal") return node.value;
	if (node.kind === "ref") return read(node.ref);
	const args = node.args.map((arg) => execute(arg, read, registry));
	validateTypes(node.op, args);
	const scope: Record<string, unknown> = Object.create(null);
	const slots: ExprNode[] = args.map((value, index) => {
		const path = `slot${index}`;
		scope[path] = value;
		return { kind: "path", path };
	});
	return evaluate({ kind: "op", op: operators[node.op], args: slots }, scope, { operators: registry, maxDepth: 4 });
}

/** Fixed per service; serialized expressions cannot select a backend or register code. */
export function createKueryBackend(): ExpressionBackend {
	const registry = createProfileRegistry();
	return {
		id: "kuery-strict-finite-v1",
		compile(input) {
			try {
				const expression = validateExpression(input);
				validate(expression);
				return { ok: true, value: { evaluate: (read) => execute(expression, read, registry) } };
			} catch (error) {
				return failure(error instanceof ExpressionError ? error.code : "backend");
			}
		},
	};
}
