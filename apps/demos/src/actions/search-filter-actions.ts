import type { ActionHandlerContext, ActionRegistration, ActionRequest, JsonValue } from "@formbar/declarative";

export const filtersAppliedEvent = "formbar:demo11-filters-applied";

function immutableSnapshot(value: JsonValue): JsonValue {
	return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
	if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}

export const searchFilterActions: readonly ActionRegistration[] = Object.freeze([
	Object.freeze({
		id: "demo11.apply-filters",
		handler: (_request: ActionRequest, context: ActionHandlerContext) => {
			if (typeof window === "undefined") return;
			window.dispatchEvent(new CustomEvent(filtersAppliedEvent, { detail: immutableSnapshot(context.snapshot.data) }));
		},
	}),
]);
