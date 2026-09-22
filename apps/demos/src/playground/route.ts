export interface AppRoute {
	readonly mode: "demo" | "playground";
	readonly demoId: string;
	readonly preset?: string;
}

export interface RouteCompatibility {
	readonly demoId: string;
	readonly support: "full" | "unsupported";
	readonly presets: readonly { readonly variant: string }[];
}

export function readRoute(
	url: URL,
	demoIds: readonly string[],
	compatibility: readonly RouteCompatibility[],
): AppRoute {
	const requestedDemo = url.searchParams.get("demo");
	const demoId = requestedDemo && demoIds.includes(requestedDemo) ? requestedDemo : (demoIds[0] ?? "");
	const requestedPlayground = url.searchParams.get("mode") === "playground";
	const entry = compatibility.find((candidate) => candidate.demoId === demoId && candidate.support === "full");
	if (!requestedPlayground || !entry || entry.presets.length === 0) return { mode: "demo", demoId };
	const requestedPreset = url.searchParams.get("preset") || undefined;
	if (!requestedPreset) return { mode: "playground", demoId };
	const preset = entry.presets.some((candidate) => candidate.variant === requestedPreset)
		? requestedPreset
		: entry.presets[0].variant;
	return { mode: "playground", demoId, preset };
}

export function resolveRoute(
	current: URL,
	requested: AppRoute,
	demoIds: readonly string[],
	compatibility: readonly RouteCompatibility[],
) {
	const requestedUrl = routeUrl(current, requested);
	const route = readRoute(requestedUrl, demoIds, compatibility);
	return { route, url: routeUrl(requestedUrl, route) };
}

export function routeUrl(current: URL, route: AppRoute): URL {
	const next = new URL(current.href);
	next.searchParams.set("mode", route.mode);
	next.searchParams.set("demo", route.demoId);
	if (route.preset) next.searchParams.set("preset", route.preset);
	else next.searchParams.delete("preset");
	return next;
}
