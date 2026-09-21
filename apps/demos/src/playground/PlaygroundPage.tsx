import { useEffect, useMemo, useState } from "react";
import { Button } from "../ui";
import { PlaygroundRunner } from "./PlaygroundRunner";
import { PreviewErrorBoundary } from "./PreviewErrorBoundary";
import { SourceEditor } from "./SourceEditor";
import { type PlaygroundPreset, SOURCE_KEYS, type SourceKey } from "./contracts";
import { formatJson, stringifyDocument } from "./document";
import { getCompatibility, getPreset } from "./presets";
import {
	applySources,
	type createPlaygroundSession,
	resetSession,
	restorePlaygroundSession,
	updateSource,
} from "./session";
import { discardDraft, saveDraft } from "./storage";

interface PlaygroundPageProps {
	readonly demoId: string;
	readonly variant?: string;
	readonly onClose: () => void;
	readonly onPresetChange: (variant: string) => void;
}

const buttonClass = "border-border bg-secondary text-secondary-foreground hover:bg-accent";

export function PlaygroundPage(props: PlaygroundPageProps) {
	const preset = getPreset(props.demoId, props.variant);
	if (!preset) return <p className="p-8">Compilation playground unavailable.</p>;
	return <Playground key={preset.key} {...props} preset={preset} />;
}

function Playground(props: PlaygroundPageProps & { readonly preset: PlaygroundPreset }) {
	const [session, setSession] = useState(() =>
		restorePlaygroundSession(props.preset.document, props.preset.key, window.localStorage),
	);
	const [active, setActive] = useState<SourceKey>("schema");
	const [status, setStatus] = useState("Compilation preview loaded.");
	const baseline = useMemo(() => stringifyDocument(props.preset.document), [props.preset]);
	const dirty = SOURCE_KEYS.some((key) => session.sources[key] !== baseline[key]);
	useDraft(props.preset, session.sources, dirty);
	const apply = () => {
		const next = applySources(session);
		setSession(next);
		setStatus(next.revision === session.revision ? "Apply failed; review source errors." : "Sources compiled.");
	};
	const reset = () => {
		discardDraft(window.localStorage, props.preset.key);
		setSession(resetSession(session, props.preset.document));
		setStatus("Preset restored.");
	};
	return (
		<main className="flex min-h-screen flex-col bg-background">
			<Header {...props} />
			<Toolbar
				onApply={apply}
				onFormat={() => formatActive(session, active, setSession, setStatus)}
				onReset={reset}
				onCopy={() => copyActive(session.sources[active], setStatus)}
				onDownload={() => download(props.preset, session.applied)}
			/>
			<output aria-live="polite" className="sr-only">
				{status}
			</output>
			<Workspace
				session={session}
				baseline={baseline}
				active={active}
				setActive={setActive}
				setSession={setSession}
				apply={apply}
			/>
		</main>
	);
}

function Workspace(props: {
	readonly session: ReturnType<typeof createPlaygroundSession>;
	readonly baseline: ReturnType<typeof stringifyDocument>;
	readonly active: SourceKey;
	readonly setActive: (key: SourceKey) => void;
	readonly setSession: (session: ReturnType<typeof createPlaygroundSession>) => void;
	readonly apply: () => void;
}) {
	return (
		<div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-2">
			<section className="flex min-h-[32rem] flex-col border-r border-border bg-card">
				<SourceEditor
					active={props.active}
					sources={props.session.sources}
					baseline={props.baseline}
					errors={props.session.errors}
					onActiveChange={props.setActive}
					onChange={(value) => props.setSession(updateSource(props.session, props.active, value))}
					onApply={props.apply}
				/>
			</section>
			<section className="overflow-auto">
				<PreviewErrorBoundary>
					<PlaygroundRunner key={props.session.revision} document={props.session.applied} />
				</PreviewErrorBoundary>
			</section>
		</div>
	);
}

function Header(props: PlaygroundPageProps & { readonly preset: PlaygroundPreset }) {
	const variants = getCompatibility(props.preset.demoId).presets;
	return (
		<header className="flex items-center gap-3 border-b border-border bg-card px-4 py-3">
			<Button className={buttonClass} onClick={props.onClose}>
				← Demo
			</Button>
			<div className="mr-auto">
				<h1 className="font-bold">Compilation playground</h1>
				<p className="text-xs text-muted-foreground">
					Document v{props.preset.document.version}; no renderer or rule execution.
				</p>
			</div>
			{variants.length > 1 && (
				<select value={props.preset.variant} onChange={(event) => props.onPresetChange(event.target.value)}>
					{variants.map((item) => (
						<option key={item.key} value={item.variant}>
							{item.label}
						</option>
					))}
				</select>
			)}
		</header>
	);
}

function Toolbar(props: {
	readonly onApply: () => void;
	readonly onFormat: () => void;
	readonly onReset: () => void;
	readonly onCopy: () => void;
	readonly onDownload: () => void;
}) {
	return (
		<div className="flex gap-2 border-b border-border bg-card px-4 py-2">
			<Button className="border-primary bg-primary text-primary-foreground" onClick={props.onApply}>
				Compile
			</Button>
			<Button className={buttonClass} onClick={props.onFormat}>
				Format active
			</Button>
			<Button className={buttonClass} onClick={props.onReset}>
				Reset preset
			</Button>
			<Button className={buttonClass} onClick={props.onCopy}>
				Copy active
			</Button>
			<Button className={buttonClass} onClick={props.onDownload}>
				Download document
			</Button>
		</div>
	);
}

function useDraft(preset: PlaygroundPreset, sources: ReturnType<typeof stringifyDocument>, dirty: boolean) {
	useEffect(() => {
		if (!dirty) return;
		const timer = window.setTimeout(() => saveDraft(window.localStorage, preset.key, sources), 500);
		return () => window.clearTimeout(timer);
	}, [dirty, preset.key, sources]);
}

function formatActive(
	session: ReturnType<typeof createPlaygroundSession>,
	active: SourceKey,
	setSession: (value: ReturnType<typeof createPlaygroundSession>) => void,
	notify: (value: string) => void,
) {
	try {
		setSession(updateSource(session, active, formatJson(JSON.parse(session.sources[active]))));
		notify(`${active} formatted.`);
	} catch {
		notify(`${active} is not valid JSON.`);
	}
}

async function copyActive(source: string, notify: (value: string) => void) {
	try {
		await navigator.clipboard.writeText(source);
		notify("Source copied.");
	} catch {
		notify("Clipboard unavailable.");
	}
}

function download(preset: PlaygroundPreset, document: PlaygroundPreset["document"]) {
	const url = URL.createObjectURL(new Blob([formatJson(document)], { type: "application/json" }));
	const anchor = window.document.createElement("a");
	anchor.href = url;
	anchor.download = `formbar-${preset.demoId}.json`;
	anchor.click();
	URL.revokeObjectURL(url);
}
