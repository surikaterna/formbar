import { useEffect, useMemo, useState } from "react";
import { PlaygroundRunner } from "./PlaygroundRunner";
import { PlaygroundHeader, PlaygroundToolbar, PlaygroundWorkspace } from "./PlaygroundShell";
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
	updateCurrentSource,
	updateSource,
} from "./session";
import { copySource, downloadJson } from "./source-export";
import { discardDraft, saveDraft } from "./storage";
import { usePlaygroundSession } from "./use-playground-session";

interface PlaygroundPageProps {
	readonly demoId: string;
	readonly variant?: string;
	readonly onClose: () => void;
	readonly onDemoChange: (demoId: string) => void;
	readonly onPresetChange: (variant: string) => void;
}

export function PlaygroundPage(props: PlaygroundPageProps) {
	const example = getPlaygroundExample(props.demoId, props.variant);
	if (!example) return <p className="p-8">Interactive playground unavailable.</p>;
	return <Playground key={example.key} {...props} example={example} />;
}

function Playground(props: PlaygroundPageProps & { readonly example: PlaygroundExample }) {
	const {
		session,
		setSession,
		status,
		setStatus,
		apply: applySession,
		reset,
		onHost,
	} = usePlaygroundSession(props.example);
	const [active, setActive] = useState<SourceKey>("schema");
	const baseline = useBaseline(props.example, session.sources);
	const apply = () => {
		const error = applySession();
		if (error) setActive(error);
	};
	return (
		<main className="flex min-h-screen flex-col bg-background">
			<Header {...props} />
			{props.example.display.description ? (
				<p className="border-b border-border bg-info-background px-4 py-3 text-sm text-foreground">
					{props.example.display.description}
				</p>
			) : null}
			<PlaygroundToolbar
				onApply={apply}
				onFormat={() => formatActive(session, active, setSession, setStatus)}
				onReset={reset}
				onCopy={() => copySource(session.sources[active], setStatus)}
				onDownload={() => downloadJson(session.applied, `formbar-${props.example.demoId}.json`)}
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
				onHost={onHost}
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
	readonly setSession: ReturnType<typeof usePlaygroundSession>["setSession"];
	readonly onHost: ReturnType<typeof usePlaygroundSession>["onHost"];
	readonly apply: () => void;
}) {
	return (
		<PlaygroundWorkspace>
			<section className="flex min-h-[32rem] flex-col border-r border-border bg-card">
				<SourceEditor
					active={props.active}
					sources={props.session.sources}
					baseline={props.baseline}
					errors={props.session.errors}
					onActiveChange={props.setActive}
					onChange={(value) =>
						props.setSession((current) => updateCurrentSource(current, props.session, props.active, value))
					}
					onApply={props.apply}
				/>
			</section>
			<section className="overflow-auto p-4" aria-label="Running preview">
				<PreviewErrorBoundary>
					<PlaygroundRunner
						key={props.session.revision}
						document={props.session.applied}
						runtime={props.session.runtime}
						previewData={props.session.previewData}
						onHost={props.onHost}
					/>
				</PreviewErrorBoundary>
			</section>
		</PlaygroundWorkspace>
	);
}

function Header(props: PlaygroundPageProps & { readonly example: PlaygroundExample }) {
	const variants = getExamplesForDemo(props.example.demoId);
	return (
		<PlaygroundHeader
			demoId={props.demoId}
			onClose={props.onClose}
			onDemoChange={props.onDemoChange}
			description={`Document v${props.example.document.version}; production renderer and runtime.`}
		>
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
		</PlaygroundHeader>
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

function useBaseline(example: PlaygroundExample, sources: ReturnType<typeof stringifyDocument>) {
	const baseline = useMemo(() => stringifyDocument(example.document), [example]);
	useDraft(
		example,
		sources,
		SOURCE_KEYS.some((key) => sources[key] !== baseline[key]),
	);
	return baseline;
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
