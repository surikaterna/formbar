import type { JsonValue } from "@formbar/expressions";
import type { DiagnosticPathSegment } from "../diagnostics.js";
import type { ActionConcurrency, ActionNode, BaseNode } from "../nodes.js";
import { binding } from "./bindings.js";
import { type NodeContext, diagnostic } from "./context.js";
import { expression, props } from "./expressions.js";
import { type JsonRecord, identifier, optionalString } from "./shape.js";

const ARRAY_ACTIONS = new Set(["array.append", "array.insert", "array.remove", "array.move", "array.swap"]);
const REQUIRED_PAYLOAD = new Set(["array.append", "array.insert", "array.move", "array.swap"]);
const PAYLOAD_FORBIDDEN = new Set(["submit", "reset", "validate"]);

export function actionNode(
	source: JsonRecord,
	path: readonly DiagnosticPathSegment[],
	context: NodeContext,
	base: BaseNode,
): ActionNode | undefined {
	const action = identifier(source.action, [...path, "action"], context);
	const label = optionalString(source.label, [...path, "label"], context);
	const payload = actionPayload(source.payload, action, [...path, "payload"], context);
	const concurrency = actionConcurrency(source.concurrency, [...path, "concurrency"], context);
	const target = actionTarget(source.target, action, [...path, "target"], context);
	const definitions = props(source.props, [...path, "props"], context.scopes, context);
	if (!action || payload === null || target === null) return undefined;
	return Object.freeze({
		...base,
		type: "action",
		action,
		...(label === undefined ? {} : { label }),
		...(payload === undefined ? {} : { payload }),
		...(concurrency === undefined ? {} : { concurrency }),
		...(target === undefined ? {} : { target }),
		...(definitions ? { props: definitions } : {}),
	});
}

function actionPayload(
	value: JsonValue | undefined,
	action: string | undefined,
	path: readonly DiagnosticPathSegment[],
	context: NodeContext,
) {
	if (value === undefined) {
		if (action && REQUIRED_PAYLOAD.has(action)) {
			diagnostic(context, "invalid-action-payload", path, "This array action requires a payload expression.");
			return null;
		}
		return undefined;
	}
	if (action && PAYLOAD_FORBIDDEN.has(action)) {
		diagnostic(context, "invalid-action-payload", path, "This built-in action does not accept a payload.");
		return null;
	}
	return expression(value, path, context.scopes, context)?.expression ?? null;
}

function actionTarget(
	value: JsonValue | undefined,
	action: string | undefined,
	path: readonly DiagnosticPathSegment[],
	context: NodeContext,
) {
	const arrayAction = action ? ARRAY_ACTIONS.has(action) : false;
	if (!arrayAction && value === undefined) return undefined;
	if (!arrayAction) {
		diagnostic(context, "invalid-action-target", path, "Only array actions accept a target.");
		return null;
	}
	if (value === undefined) {
		diagnostic(context, "invalid-action-target", path, "Array actions require a data target.");
		return null;
	}
	const target = binding(value, path, context.scopes, context);
	if (target?.namespace === "data") return target;
	if (target) diagnostic(context, "invalid-action-target", path, "Array actions require a data target.");
	return null;
}

function actionConcurrency(
	value: JsonValue | undefined,
	path: readonly DiagnosticPathSegment[],
	context: NodeContext,
): ActionConcurrency | undefined {
	if (value === undefined) return undefined;
	if (value === "drop" || value === "replace" || value === "queue") return value;
	diagnostic(context, "invalid-action-concurrency", path, "Expected 'drop', 'replace', or 'queue'.");
	return undefined;
}
