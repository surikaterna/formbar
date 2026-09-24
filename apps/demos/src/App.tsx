import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import "./globals.css";
import "./demo17.css";
import { demos } from "./demos/index";
import { PlaygroundPage } from "./playground/PlaygroundPage";
import { getPlaygroundCompatibility } from "./playground/examples";
import { type AppRoute, readRoute, resolveRoute, routeUrl } from "./playground/route";
import { Button, ScrollArea, cn } from "./ui";

const demoIds = demos.map((demo) => demo.id);
const compatibility = getPlaygroundCompatibility();

function useAppRoute() {
	const [route, setRoute] = useState(() => readRoute(new URL(window.location.href), demoIds, compatibility));
	useEffect(() => {
		const onPopState = () => setRoute(readRoute(new URL(window.location.href), demoIds, compatibility));
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, []);
	useEffect(() => {
		window.history.replaceState(null, "", routeUrl(new URL(window.location.href), route));
	}, [route]);
	const navigate = useCallback((next: AppRoute) => {
		const { route, url } = resolveRoute(new URL(window.location.href), next, demoIds, compatibility);
		window.history.pushState(null, "", url);
		setRoute(route);
	}, []);
	return { route, navigate };
}

function playgroundRoute(demoId: string): AppRoute {
	const presets = compatibility.find((entry) => entry.demoId === demoId)?.presets ?? [];
	return { mode: "playground", demoId, ...(presets.length > 1 ? { preset: presets[0].variant } : {}) };
}

export function App() {
	const { route, navigate } = useAppRoute();
	const hasPlayground = compatibility.some((entry) => entry.demoId === route.demoId && entry.support === "full");
	if (route.mode === "playground" && hasPlayground) {
		return (
			<PlaygroundPage
				demoId={route.demoId}
				{...(route.preset ? { variant: route.preset } : {})}
				onClose={() => navigate({ mode: "demo", demoId: route.demoId })}
				onDemoChange={(demoId) => navigate(playgroundRoute(demoId))}
				onPresetChange={(preset) => navigate({ ...route, preset })}
			/>
		);
	}
	const activeDemo = demos.findIndex((demo) => demo.id === route.demoId);
	const Demo = demos[activeDemo]?.component;
	return (
		<div className="flex h-screen min-w-0 flex-col md:flex-row">
			<DemoNavigation activeDemo={activeDemo} onSelect={(demoId) => navigate({ mode: "demo", demoId })} />
			<main className="min-h-0 min-w-0 flex-1 overflow-auto">
				{hasPlayground ? (
					<div className="sticky top-0 z-10 flex justify-end border-b border-border bg-background/95 px-4 py-2">
						<Button
							className="border-primary bg-primary text-primary-foreground"
							onClick={() => navigate(playgroundRoute(route.demoId))}
						>
							Open in Playground
						</Button>
					</div>
				) : null}
				{Demo ? <Demo /> : <div className="p-8 text-muted-foreground">No demos available</div>}
			</main>
		</div>
	);
}

function DemoNavigation(props: { readonly activeDemo: number; readonly onSelect: (demoId: string) => void }) {
	const [open, setOpen] = useState(false);
	const disclosure = useRef<HTMLButtonElement>(null);
	const restoreFocus = useRef(false);
	useEffect(() => {
		if (open || !restoreFocus.current) return;
		restoreFocus.current = false;
		if (disclosure.current?.getClientRects().length) disclosure.current.focus();
	}, [open]);
	const select = (demoId: string) => {
		restoreFocus.current = open;
		props.onSelect(demoId);
		setOpen(false);
	};
	return (
		<aside className="flex w-full shrink-0 flex-col border-b border-border bg-card md:w-72 md:border-b-0 md:border-r">
			<div className="border-b border-border p-4">
				<h1 className="text-lg font-bold text-foreground">Formbar Demos</h1>
				<p className="mt-1 text-xs text-muted-foreground">JSON Schema → validated FormDefinition</p>
				<button
					ref={disclosure}
					type="button"
					className="mt-3 w-full rounded-md border border-border px-3 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:hidden"
					aria-controls="demo-navigation-list"
					aria-expanded={open}
					onClick={() => setOpen((value) => !value)}
				>
					Browse demos — {demos[props.activeDemo]?.title ?? "Select a demo"} {open ? "▴" : "▾"}
				</button>
			</div>
			<ScrollArea className={cn("max-h-[50vh] md:max-h-none md:min-h-0 md:flex-1", !open && "hidden md:block")}>
				<DemoLinks activeDemo={props.activeDemo} onSelect={select} />
			</ScrollArea>
		</aside>
	);
}

function DemoLinks(props: { readonly activeDemo: number; readonly onSelect: (demoId: string) => void }) {
	return (
		<nav id="demo-navigation-list" aria-label="Demo navigation" className="flex flex-col gap-1 p-2">
			{demos.map((demo, index) => (
				<Fragment key={demo.id}>
					{(index === 0 || demos[index - 1].category !== demo.category) && (
						<div className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
							{demo.category}
						</div>
					)}
					<button
						type="button"
						aria-current={index === props.activeDemo ? "page" : undefined}
						onClick={() => props.onSelect(demo.id)}
						className={cn(
							"rounded-md px-3 py-2 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
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
	);
}
