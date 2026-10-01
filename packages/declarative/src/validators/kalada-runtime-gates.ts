import { type JsonValue, copyJson } from "@formbar/expressions";
import { isDuration, isInstant, isOption, isResult } from "@kalada/core";
import type { ReadScope } from "./kalada-data-strategy.js";
import type { AdmittedDefinition } from "./kalada-definition.js";

export type Evaluation =
	| { readonly ok: true; readonly value: JsonValue }
	| { readonly ok: false; readonly path: string; readonly code: string };

export function validScope(scope: ReadScope, enclosing: string | undefined, admitted: AdmittedDefinition): boolean {
	const expected: string[] = [];
	let name = enclosing;
	while (name !== undefined) {
		expected.unshift(name);
		name = admitted.scopes[name]?.parent;
		if (expected.length > 32) return false;
	}
	return (
		scope.rows.length === expected.length &&
		scope.rows.every(
			(row, index) => row.name === expected[index] && typeof row.token === "object" && row.token !== null,
		)
	);
}

export function safeResult(value: unknown, kind: "boolean" | "json", path: string): Evaluation {
	if (isOption(value) || isResult(value) || isInstant(value) || isDuration(value))
		return { ok: false, path, code: "INVALID_RESULT_TYPE" };
	if (kind === "boolean" && typeof value !== "boolean") return { ok: false, path, code: "BOOLEAN_REQUIRED" };
	try {
		return { ok: true, value: copyJson(value) };
	} catch {
		return { ok: false, path, code: "NON_JSON_RESULT" };
	}
}
