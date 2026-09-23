import { useEffect, useMemo, useState } from "react";
import { demos } from "../demos/registry";
import { Button } from "../ui";
import { PlaygroundRunner } from "./PlaygroundRunner";
import { PreviewErrorBoundary } from "./PreviewErrorBoundary";
import { SourceEditor } from "./SourceEditor";
import { type PlaygroundExample, SOURCE_KEYS, type SourceKey } from "./contracts";
import { formatJson, stringifyDocument } from "./document";
import { exampleVariant, getExamplesForDemo, getPlaygroundExample } from "./examples";
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
	readonly onDemoChange: (demoId: string) => void;
	readonly onPresetChange: (variant: string) => void;
}

const buttonClass = "border-border bg-secondary text-secondary-foreground hover:bg-accent";

export function PlaygroundPage(props: PlaygroundPageProps) {
	const example = getPlaygroundExample(props.demoId, props.variant);
	if (!example) return <p className="p-8">Interactive playground unavailable.</p>;
	return <Playground key={example.key} {...props} example={example} />;
}

function Playground(props: PlaygroundPageProps & { readonly example: PlaygroundExample }) {
	const [session, setSession] = useState(() =>
		restorePlaygroundSession(props.example.document, props.example.key, window.localStorage),
	);
	const [active, setActive] = useState<SourceKey>("schema");
	const [status, setStatus] = useState("Interactive playground loaded.");
	const baseline = useMemo(() => stringifyDocument(props.example.document), [props.example]);
	const dirty = SOURCE_KEYS.some((key) => session.sources[key] !== baseline[key]);
	useDraft(props.example, session.sources, dirty);
	const apply = () => {
		const next = applySources(session);
		setSession(next);
		if (next.revision === session.revision) {
			const firstError = SOURCE_KEYS.find((key) => next.errors[key]);
			if (firstError) setActive(firstError);
		}
		setStatus(next.revision === session.revision ? "Apply failed; review source errors." : "Document applied.");
	};
	const reset = () => {
		discardDraft(window.localStorage, props.example.key);
		setSession(resetSession(session, props.example.document));
		setStatus("Registry example restored.");
	};
	return (
		<main className="flex min-h-screen flex-col bg-background">
			<Header {...props} />
			<Toolbar
				onApply={apply}
				onFormat={() => formatActive(session, active, setSession, setStatus)}
				onReset={reset}
				onCopy={() => copyActive(session.sources[active], setStatus)}
				onDownload={() => download(props.example, session.applied)}
			/>
			<output aria-live="polite" className="sr-only">
				{status}
			</output>
			<RuntimeContext example={props.example} />
			<Workspace
				example={props.example}
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
	readonly example: PlaygroundExample;
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
			<section className="overflow-auto p-4" aria-label="Running preview">
				<PreviewErrorBoundary>
					<PlaygroundRunner
						key={props.session.revision}
						document={props.session.applied}
						runtime={props.example.runtime}
					/>
				</PreviewErrorBoundary>
			</section>
		</div>
	);
}

function Header(props: PlaygroundPageProps & { readonly example: PlaygroundExample }) {
	const variants = getExamplesForDemo(props.example.demoId);
	return (
		<header className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-3">
			<Button className={buttonClass} onClick={props.onClose}>
				← Demo
			</Button>
			<div className="mr-auto min-w-52">
				<h1 className="font-bold">Interactive playground</h1>
				<p className="text-xs text-muted-foreground">
					Document v{props.example.document.version}; production renderer and runtime.
				</p>
			</div>
			<label className="text-sm font-medium">
				Demo
				<select
					className="ml-2"
					value={props.example.demoId}
					onChange={(event) => props.onDemoChange(event.currentTarget.value)}
				>
					<optgroup label="Numbered demos">
						{demos.filter(({ number }) => number !== undefined).map(demoOption)}
					</optgroup>
					<optgroup label="Other examples">
						{demos.filter(({ number }) => number === undefined).map(demoOption)}
					</optgroup>
				</select>
			</label>
			{variants.length > 1 ? (
				<label className="text-sm font-medium">
					Example
					<select
						className="ml-2"
						value={exampleVariant(props.example)}
						onChange={(event) => props.onPresetChange(event.currentTarget.value)}
					>
						{variants.map((item) => (
							<option key={item.key} value={exampleVariant(item)}>
								{item.display.sourceLabel}
								{item.display.definitionLabel ? ` — ${item.display.definitionLabel}` : ""}
							</option>
						))}
					</select>
				</label>
			) : null}
		</header>
	);
}

function demoOption(demo: (typeof demos)[number]) {
	return (
		<option key={demo.id} value={demo.id}>
			{demo.number ? `${demo.number}. ` : ""}
			{demo.title.replace(/^\d+\.\s*/, "")}
		</option>
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
		<div className="flex flex-wrap gap-2 border-b border-border bg-card px-4 py-2">
			<Button className="border-primary bg-primary text-primary-foreground" onClick={props.onApply}>
				Apply
			</Button>
			<Button className={buttonClass} onClick={props.onFormat}>
				Format active
			</Button>
			<Button className={buttonClass} onClick={props.onReset}>
				Reset example
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

function RuntimeContext({ example }: { readonly example: PlaygroundExample }) {
	return (
		<details className="border-b border-border bg-card px-4 py-3">
			<summary className="cursor-pointer font-semibold">Fixed trusted runtime context (read-only)</summary>
			<p className="mt-2 text-sm text-muted-foreground">
				Executable implementations are host-owned and cannot be edited or loaded from JSON.
			</p>
			<pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-3 text-xs">
				{JSON.stringify(example.runtime, null, 2)}
			</pre>
		</details>
	);
}

function useDraft(example: PlaygroundExample, sources: ReturnType<typeof stringifyDocument>, dirty: boolean) {
	useEffect(() => {
		if (!dirty) return;
		const timer = window.setTimeout(() => saveDraft(window.localStorage, example.key, sources), 500);
		return () => window.clearTimeout(timer);
	}, [dirty, example.key, sources]);
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

function download(example: PlaygroundExample, document: PlaygroundExample["document"]) {
	const url = URL.createObjectURL(new Blob([formatJson(document)], { type: "application/json" }));
	const anchor = window.document.createElement("a");
	anchor.href = url;
	anchor.download = `formbar-${example.demoId}.json`;
	anchor.click();
	URL.revokeObjectURL(url);
}
