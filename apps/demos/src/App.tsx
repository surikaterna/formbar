import { Fragment, useCallback, useEffect, useState } from "react";
import "./globals.css";
import { demos } from "./demos/index";
import { PlaygroundPage } from "./playground/PlaygroundPage";
import { compatibilityMatrix, getCompatibility } from "./playground/presets";
import { type AppRoute, readRoute, routeUrl } from "./playground/route";
import { Button, ScrollArea, cn } from "./ui";

const demoIds = demos.map((demo) => demo.id);
const playgroundIds = compatibilityMatrix.map((entry) => entry.demoId);

function useAppRoute() {
	const [route, setRoute] = useState(() => readRoute(new URL(window.location.href), demoIds, playgroundIds));
	useEffect(() => {
		const onPopState = () => setRoute(readRoute(new URL(window.location.href), demoIds, playgroundIds));
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, []);
	useEffect(() => {
		window.history.replaceState(null, "", routeUrl(new URL(window.location.href), route));
	}, [route]);
	const navigate = useCallback((next: AppRoute) => {
		const url = routeUrl(new URL(window.location.href), next);
		window.history.pushState(null, "", url);
		setRoute(readRoute(url, demoIds, playgroundIds));
	}, []);
	return { route, navigate };
}

function playgroundRoute(demoId: string): AppRoute {
	const presets = getCompatibility(demoId).presets;
	return { mode: "playground", demoId, ...(presets.length > 1 ? { preset: presets[0].variant } : {}) };
}

export function App() {
	const { route, navigate } = useAppRoute();
	const hasPlayground = compatibilityMatrix.some((entry) => entry.demoId === route.demoId);
	if (route.mode === "playground" && hasPlayground) {
		return (
			<PlaygroundPage
				demoId={route.demoId}
				{...(route.preset ? { variant: route.preset } : {})}
				onClose={() => navigate({ mode: "demo", demoId: route.demoId })}
				onPresetChange={(preset) => navigate({ ...route, preset })}
			/>
		);
	}
	const activeDemo = demos.findIndex((demo) => demo.id === route.demoId);
	const Demo = demos[activeDemo]?.component;
	return (
		<div className="flex h-screen">
			<DemoNavigation activeDemo={activeDemo} onSelect={(demoId) => navigate({ mode: "demo", demoId })} />
			<main className="flex-1 overflow-auto">
				{hasPlayground ? (
					<div className="sticky top-0 z-10 flex justify-end border-b border-border bg-background/95 px-4 py-2">
						<Button
							className="border-primary bg-primary text-primary-foreground"
							onClick={() => navigate(playgroundRoute(route.demoId))}
						>
							Open compilation playground
						</Button>
					</div>
				) : null}
				{Demo ? <Demo /> : <div className="p-8 text-muted-foreground">No demos available</div>}
			</main>
		</div>
	);
}

function DemoNavigation(props: { readonly activeDemo: number; readonly onSelect: (demoId: string) => void }) {
	return (
		<aside className="flex w-72 flex-col border-r border-border bg-card">
			<div className="border-b border-border p-4">
				<h1 className="text-lg font-bold text-foreground">Formbar Demos</h1>
				<p className="mt-1 text-xs text-muted-foreground">JSON Schema → validated FormDefinition</p>
			</div>
			<ScrollArea className="flex-1">
				<nav className="flex flex-col gap-1 p-2">
					{demos.map((demo, index) => (
						<Fragment key={demo.id}>
							{(index === 0 || demos[index - 1].category !== demo.category) && (
								<div className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
									{demo.category}
								</div>
							)}
							<button
								type="button"
								onClick={() => props.onSelect(demo.id)}
								className={cn(
									"rounded-md px-3 py-2 text-left text-sm transition-colors",
									index === props.activeDemo
										? "bg-accent text-accent-foreground"
										: "text-muted-foreground hover:bg-accent/50",
								)}
							>
								<div className="font-medium">{demo.title}</div>
								<div className="mt-0.5 text-xs opacity-70">{demo.subtitle}</div>
							</button>
						</Fragment>
					))}
				</nav>
			</ScrollArea>
		</aside>
	);
}
