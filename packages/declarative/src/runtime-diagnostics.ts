import type { DiagnosticCode } from "@formbar/expressions";
import type {
	RuntimeDiagnostic,
	RuntimeDiagnosticCode,
	RuntimeExpressionProperty,
	RuntimeNodeInstance,
} from "./runtime-contracts.js";

export function runtimeDiagnostic(
	code: RuntimeDiagnosticCode,
	instance: RuntimeNodeInstance,
	property: RuntimeExpressionProperty | "baseline",
	expressionCode?: DiagnosticCode,
): RuntimeDiagnostic {
	return Object.freeze({
		code,
		nodeId: instance.nodeId,
		instanceKey: instance.instanceKey,
		property,
		...(expressionCode ? { expressionCode } : {}),
	});
}

export function sortRuntimeDiagnostics(diagnostics: readonly RuntimeDiagnostic[]): readonly RuntimeDiagnostic[] {
	return Object.freeze(
		[...diagnostics].sort(
			(left, right) =>
				left.instanceKey.localeCompare(right.instanceKey) ||
				left.nodeId.localeCompare(right.nodeId) ||
				left.property.localeCompare(right.property) ||
				left.code.localeCompare(right.code) ||
				(left.expressionCode ?? "").localeCompare(right.expressionCode ?? ""),
		),
	);
}
