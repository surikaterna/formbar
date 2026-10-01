import type { CreateKaladaV1HostOptions, KaladaV1Host } from "@formbar/declarative";
import { filtersAppliedEvent } from "../actions/search-filter-actions";
import type { ResolvedRuntimeProfiles } from "./trusted-runtime-profiles";

const widgetProps = {
	label: { modes: ["literal"], expected: "string" },
	description: { modes: ["literal"], expected: "string" },
	richOptions: { modes: ["literal"], expected: "array" },
	icon: { modes: ["literal"], expected: "string" },
	liveLabel: { modes: ["literal"], expected: "boolean" },
	options: { modes: ["literal"], expected: "array" },
	min: { modes: ["literal"], expected: "number" },
	step: { modes: ["literal"], expected: "number" },
};

export function demoPolicy(
	identity: CreateKaladaV1HostOptions["identity"],
	profiles: ResolvedRuntimeProfiles,
	paths: readonly { path: readonly unknown[]; kind: "array" | "value" }[],
	uiPaths: readonly string[][],
) {
	const widgets = new Set(profiles.extensions?.widgets?.map(({ id }) => id));
	const renderers = new Set(profiles.extensions?.nodes?.map(({ id }) => id));
	return {
		policy: {
			...identity,
			widgets: Object.fromEntries(
				[...widgets].map((id) => [
					id,
					{
						children: "forbidden",
						props:
							id === "demo16.range" ? { ...widgetProps, max: { modes: ["literal"], expected: "number" } } : widgetProps,
					},
				]),
			),
			renderers: Object.fromEntries(
				[...renderers].map((id) => [
					id,
					{
						children: "allowed",
						props: {
							title: { modes: ["literal"], expected: "string" },
							columns: { modes: ["literal"], expected: "number" },
						},
					},
				]),
			),
			actions: Object.fromEntries((profiles.actions ?? []).map(({ id }) => [id, { children: "forbidden", props: {} }])),
			namespaces: { data: "available", ...(uiPaths.length ? { ui: "available" } : {}) },
			schema: { side: "input", availability: "complete", paths },
			ui: { availability: "complete", paths: uiPaths.map((path) => ({ path, kind: "value" as const })) },
		},
		trustedWidgets: widgets,
		trustedRenderers: renderers,
	};
}

type Action = NonNullable<NonNullable<CreateKaladaV1HostOptions["installed"]>["actions"]>[string];
function frozen<T>(value: T): T {
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) frozen(child);
		Object.freeze(value);
	}
	return value;
}

export function demoActions(
	profiles: ResolvedRuntimeProfiles,
	host: () => KaladaV1Host,
): Readonly<Record<string, Action>> {
	if (!profiles.actions?.some(({ id }) => id === "demo11.apply-filters")) return {};
	return {
		"demo11.apply-filters": async (request) => {
			if (!request.fresh() || request.signal.aborted) return { status: "stale" };
			if (!request.validate) return { status: "unsupported" };
			const result = await request.validate();
			if (!request.fresh() || request.signal.aborted) return { status: "stale" };
			if (!result.ok) return { status: "denied" };
			const detail = frozen(structuredClone(host().snapshot().data));
			if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(filtersAppliedEvent, { detail }));
			return { status: "applied" };
		},
	};
}
