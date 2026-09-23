import type { ActionRegistration } from "@formbar/declarative";
import type { RendererExtensions } from "@formbar/react-schema";
import { searchFilterActions } from "../actions/search-filter-actions";
import type { TrustedRuntimeProfileId } from "../demos/baseline-contracts";
import { customLayoutRegistrations } from "../extensions/custom-layout-profile";
import { customWidgetRegistrations } from "../extensions/custom-widget-profile";
import { numericPresentationRegistrations } from "../extensions/numeric-presentation-profile";
import type { RuntimeCapabilityDeclaration } from "../playground/contracts";

interface CatalogEntry {
	readonly extensions?: RendererExtensions;
	readonly actions?: readonly ActionRegistration[];
	readonly capabilities: readonly RuntimeCapabilityDeclaration[];
}

export interface RuntimeProfileDiagnostic {
	readonly code: "unknown-profile" | "duplicate-profile" | "conflicting-registration" | "invalid-capabilities";
	readonly profileId: string;
	readonly registrationId?: string;
}

export interface ResolvedRuntimeProfiles {
	readonly ok: boolean;
	readonly extensions?: RendererExtensions;
	readonly actions?: readonly ActionRegistration[];
	readonly capabilities: readonly RuntimeCapabilityDeclaration[];
	readonly diagnostics: readonly RuntimeProfileDiagnostic[];
}

const standardCapabilities: readonly RuntimeCapabilityDeclaration[] = Object.freeze([
	Object.freeze({ kind: "validator", id: "draft-2020-12" }),
	Object.freeze({ kind: "repeater", id: "formbar.repeater" }),
	Object.freeze({ kind: "output", id: "formbar.output" }),
]);

const catalog: Readonly<Record<TrustedRuntimeProfileId, CatalogEntry>> = Object.freeze({
	"formbar.standard.v1": Object.freeze({ capabilities: standardCapabilities }),
	"formbar.arbiter.v1": Object.freeze({
		capabilities: Object.freeze([Object.freeze({ kind: "arbiter", id: "formbar.arbiter" })]),
	}),
	"demo11.search-actions.v1": Object.freeze({
		actions: searchFilterActions,
		capabilities: Object.freeze(searchFilterActions.map(({ id }) => Object.freeze({ kind: "action" as const, id }))),
	}),
	"demo16.trusted-widgets.v1": Object.freeze({
		extensions: Object.freeze({ widgets: customWidgetRegistrations }),
		capabilities: Object.freeze(
			customWidgetRegistrations.map(({ id }) => Object.freeze({ kind: "widget" as const, id })),
		),
	}),
	"demo17.advanced-layout.v1": Object.freeze({
		extensions: Object.freeze({ nodes: customLayoutRegistrations }),
		capabilities: Object.freeze(
			customLayoutRegistrations.map(({ id }) => Object.freeze({ kind: "custom-node" as const, id })),
		),
	}),
	"demo19.numeric-presentation.v1": Object.freeze({
		extensions: Object.freeze({ widgets: numericPresentationRegistrations }),
		capabilities: Object.freeze([Object.freeze({ kind: "widget", id: "demo19.numeric-presentation" })]),
	}),
});

export const trustedRuntimeProfileIds = Object.freeze(Object.keys(catalog) as TrustedRuntimeProfileId[]);

export function resolveTrustedRuntimeProfiles(profileIds: readonly string[]): ResolvedRuntimeProfiles {
	const diagnostics = profileDiagnostics(profileIds);
	if (diagnostics.length) return rejected(diagnostics);
	const selected = profileIds.map((profileId) => ({ profileId, entry: catalogEntry(profileId) }));
	const invalid = selected.flatMap(({ profileId, entry }) =>
		entry && validCapabilities(entry.capabilities) ? [] : [{ code: "invalid-capabilities" as const, profileId }],
	);
	if (invalid.length) return rejected(invalid);
	const entries = selected.flatMap(({ entry }) => (entry ? [entry] : []));
	const conflicts = registrationConflicts(profileIds, entries);
	if (conflicts.length) return rejected(conflicts);
	const widgets = entries.flatMap((entry) => entry.extensions?.widgets ?? []);
	const nodes = entries.flatMap((entry) => entry.extensions?.nodes ?? []);
	const actions = entries.flatMap((entry) => entry.actions ?? []);
	return Object.freeze({
		ok: true,
		...(widgets.length || nodes.length ? { extensions: Object.freeze({ widgets, nodes }) } : {}),
		...(actions.length ? { actions: Object.freeze(actions) } : {}),
		capabilities: Object.freeze(entries.flatMap(({ capabilities }) => capabilities)),
		diagnostics: Object.freeze([]),
	});
}

function profileDiagnostics(profileIds: readonly unknown[]): RuntimeProfileDiagnostic[] {
	const diagnostics: RuntimeProfileDiagnostic[] = [];
	const seen = new Set<string>();
	for (const value of profileIds) {
		const profileId = diagnosticProfileId(value);
		if (!catalogEntry(value)) diagnostics.push({ code: "unknown-profile", profileId });
		else if (seen.has(profileId)) diagnostics.push({ code: "duplicate-profile", profileId });
		seen.add(profileId);
	}
	return diagnostics;
}

function catalogEntry(profileId: unknown): CatalogEntry | undefined {
	if (typeof profileId !== "string" || !Object.hasOwn(catalog, profileId)) return undefined;
	return catalog[profileId as TrustedRuntimeProfileId];
}

function diagnosticProfileId(value: unknown): string {
	if (typeof value === "string") return value;
	if (typeof value === "symbol") return `Symbol(${value.description ?? ""})`;
	return `<${value === null ? "null" : typeof value}>`;
}

function validCapabilities(capabilities: readonly RuntimeCapabilityDeclaration[]): boolean {
	return Array.isArray(capabilities) && capabilities.every(validCapability);
}

function validCapability(capability: RuntimeCapabilityDeclaration): boolean {
	if (!capability || typeof capability !== "object") return false;
	const kind = ownString(capability, "kind");
	const id = ownString(capability, "id");
	if (!kind || !id) return false;
	if (kind === "validator") return id === "draft-2020-12";
	if (kind === "arbiter") return id === "formbar.arbiter";
	if (kind === "repeater") return id === "formbar.repeater";
	if (kind === "output") return id === "formbar.output";
	if (kind === "action-controls") return id === "host" || id === "definition";
	return kind === "action" || kind === "widget" || kind === "custom-node";
}

function ownString(value: object, key: string): string | undefined {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	return descriptor && "value" in descriptor && typeof descriptor.value === "string" ? descriptor.value : undefined;
}

function registrationConflicts(profileIds: readonly string[], entries: readonly CatalogEntry[]) {
	const diagnostics: RuntimeProfileDiagnostic[] = [];
	const seen = new Map<string, string>();
	for (const [index, entry] of entries.entries()) {
		const ids = [
			...(entry.extensions?.widgets?.map(({ id }) => `widget:${id}`) ?? []),
			...(entry.extensions?.nodes?.map(({ id }) => `node:${id}`) ?? []),
			...(entry.actions?.map(({ id }) => `action:${id}`) ?? []),
		];
		for (const id of ids) {
			if (seen.has(id))
				diagnostics.push({ code: "conflicting-registration", profileId: profileIds[index], registrationId: id });
			else seen.set(id, profileIds[index]);
		}
	}
	return diagnostics;
}

function rejected(diagnostics: readonly RuntimeProfileDiagnostic[]): ResolvedRuntimeProfiles {
	return Object.freeze({ ok: false, capabilities: Object.freeze([]), diagnostics: Object.freeze(diagnostics) });
}
