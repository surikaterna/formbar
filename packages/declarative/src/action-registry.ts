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

interface NormalizedRegistration {
	readonly id: string;
	readonly handler: ActionHandler;
}

const INVALID_REGISTRY: ActionRegistry = Object.freeze({
	handlers: new Map(),
	diagnostics: Object.freeze([Object.freeze({ code: "invalid-registration" as const })]),
});

export function normalizeActions(registrations: readonly ActionRegistration[] | undefined): ActionRegistry {
	try {
		return normalizeActionsUnsafe(registrations ?? []);
	} catch {
		return INVALID_REGISTRY;
	}
}

function normalizeActionsUnsafe(registrations: readonly ActionRegistration[]): ActionRegistry {
	const grouped = new Map<string, NormalizedRegistration[]>();
	const diagnostics: ActionDiagnostic[] = [];
	for (const value of arrayValues(registrations)) {
		const registration = registrationValue(value);
		if (!registration) throw new TypeError("invalid registry");
		if (BUILT_IN_ACTIONS.has(registration.id)) {
			diagnostics.push(Object.freeze({ code: "reserved-action-registration", action: registration.id }));
			continue;
		}
		grouped.set(registration.id, [...(grouped.get(registration.id) ?? []), registration]);
	}
	return createRegistry(grouped, diagnostics);
}

function arrayValues(value: readonly ActionRegistration[]): readonly unknown[] {
	if (!Array.isArray(value)) throw new TypeError("invalid registry");
	const keys = Reflect.ownKeys(value);
	const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
	if (!Number.isSafeInteger(length) || length < 0) throw new TypeError("invalid registry");
	if (keys.some((key) => !validArrayKey(key, length))) throw new TypeError("invalid registry");
	const entries: unknown[] = [];
	for (let index = 0; index < length; index++) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor || !("value" in descriptor)) entries.push(undefined);
		else entries.push(descriptor.value);
	}
	return entries;
}

function validArrayKey(key: PropertyKey, length: number): boolean {
	if (key === "length") return true;
	if (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/.test(key)) return false;
	return Number(key) < length;
}

function registrationValue(value: unknown): NormalizedRegistration | undefined {
	if (value === null || typeof value !== "object") return undefined;
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (Reflect.ownKeys(descriptors).some((key) => key !== "id" && key !== "handler")) return undefined;
	const id = dataValue(descriptors.id);
	const handler = dataValue(descriptors.handler);
	if (typeof id !== "string" || typeof handler !== "function") return undefined;
	if (id.length === 0 || id.length > 256 || ["__proto__", "constructor", "prototype"].includes(id)) return undefined;
	return Object.freeze({ id, handler: handler as ActionHandler });
}

function dataValue(descriptor: PropertyDescriptor | undefined): unknown {
	return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function createRegistry(
	grouped: ReadonlyMap<string, readonly NormalizedRegistration[]>,
	diagnostics: ActionDiagnostic[],
): ActionRegistry {
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
