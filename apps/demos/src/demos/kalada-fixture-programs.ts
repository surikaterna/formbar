import type { DefinitionProgram, JsonValue } from "@formbar/declarative";
import { kaladaJson } from "../runtime/kalada-demo-json";

type AuthoredProgram = DefinitionProgram;
const program = (expression: DefinitionProgram["expression"]): AuthoredProgram => ({
	format: "kalada-program",
	version: 1,
	profile: "kalada-v1",
	expression,
});

export const dataRef = (path: string): AuthoredProgram =>
	program({ kind: "ref", ref: { namespace: "data", segments: [path] } });
export const uiRef = (path: string): AuthoredProgram =>
	program({ kind: "ref", ref: { namespace: "ui", segments: [path] } });
export const literal = (value: JsonValue): AuthoredProgram => program({ kind: "literal", value: kaladaJson(value) });
export const numeric = (
	operator: "add" | "subtract" | "multiply" | "divide",
	left: AuthoredProgram,
	right: AuthoredProgram,
): AuthoredProgram => program({ kind: "numeric-binary", operator, left: left.expression, right: right.expression });
export const equality = (
	operator: "equal" | "not-equal",
	left: AuthoredProgram,
	right: AuthoredProgram,
): AuthoredProgram => program({ kind: "equality", operator, left: left.expression, right: right.expression });
export const and = (left: AuthoredProgram, right: AuthoredProgram): AuthoredProgram =>
	program({ kind: "boolean-logical", operator: "and", left: left.expression, right: right.expression });
export const not = (operand: AuthoredProgram): AuthoredProgram =>
	program({ kind: "boolean-not", operand: operand.expression });
// The installed demo strategy represents absent JSON values as null, not as an Option.
export const present = (value: AuthoredProgram): AuthoredProgram => equality("not-equal", value, literal(null));
export const jsonDefault = (value: AuthoredProgram, fallback: AuthoredProgram): AuthoredProgram =>
	program({
		kind: "conditional",
		condition: present(value).expression,
		// biome-ignore lint/suspicious/noThenProperty: Canonical Kalada conditional data, not a thenable.
		then: value.expression,
		else: fallback.expression,
	});
