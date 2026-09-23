import type { ActionDiagnostic, ActionHandler, ActionRegistration, BuiltInActionId } from "./actions.js";

export const BUILT_IN_ACTIONS: ReadonlySet<string> = new Set<BuiltInActionId>([
	"submit",
	"reset",
	"validate",
	"array.append",
	"array.insert",
	"array.remove",
	"array.move",
	"array.swap",
]);

export interface ActionRegistry {
	readonly handlers: ReadonlyMap<string, ActionHandler>;
	readonly diagnostics: readonly ActionDiagnostic[];
}

export function normalizeActions(registrations: readonly ActionRegistration[] = []): ActionRegistry {
	const grouped = new Map<string, ActionRegistration[]>();
	const diagnostics: ActionDiagnostic[] = [];
	for (const registration of registrations) {
		if (!validRegistration(registration)) {
			diagnostics.push(Object.freeze({ code: "invalid-registration" }));
			continue;
		}
		if (BUILT_IN_ACTIONS.has(registration.id)) {
			diagnostics.push(Object.freeze({ code: "reserved-action-registration", action: registration.id }));
			continue;
		}
		grouped.set(registration.id, [...(grouped.get(registration.id) ?? []), registration]);
	}
	const handlers = new Map<string, ActionHandler>();
	for (const [id, entries] of grouped) {
		if (entries.length > 1) diagnostics.push(Object.freeze({ code: "duplicate-action-registration", action: id }));
		else handlers.set(id, entries[0]?.handler as ActionHandler);
	}
	diagnostics.sort(
		(left, right) => left.code.localeCompare(right.code) || (left.action ?? "").localeCompare(right.action ?? ""),
	);
	return Object.freeze({ handlers, diagnostics: Object.freeze(diagnostics) });
}

function validRegistration(value: ActionRegistration): boolean {
	if (!value || typeof value !== "object" || typeof value.handler !== "function") return false;
	if (typeof value.id !== "string" || value.id.length === 0 || value.id.length > 256) return false;
	return !["__proto__", "constructor", "prototype"].includes(value.id);
}
