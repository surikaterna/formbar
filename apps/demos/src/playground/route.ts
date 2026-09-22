export interface AppRoute {
	readonly mode: "demo" | "playground";
	readonly demoId: string;
	readonly preset?: string;
}

export function readRoute(url: URL, demoIds: readonly string[], playgroundIds: readonly string[]): AppRoute {
	const requestedDemo = url.searchParams.get("demo");
	const demoId = requestedDemo && demoIds.includes(requestedDemo) ? requestedDemo : (demoIds[0] ?? "");
	const requestedPlayground = url.searchParams.get("mode") === "playground";
	const mode = requestedPlayground && playgroundIds.includes(demoId) ? "playground" : "demo";
	const preset = url.searchParams.get("preset") || undefined;
	return { mode, demoId, ...(mode === "playground" && preset ? { preset } : {}) };
}

export function routeUrl(current: URL, route: AppRoute): URL {
	const next = new URL(current.href);
	next.searchParams.set("mode", route.mode);
	next.searchParams.set("demo", route.demoId);
	if (route.preset) next.searchParams.set("preset", route.preset);
	else next.searchParams.delete("preset");
	return next;
}
