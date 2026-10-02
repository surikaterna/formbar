import type { FsxDiagnostic } from "@formbar/fsx-authoring";
import { type RefObject, useId, useRef, useState } from "react";
import { PlaygroundToolbar, PlaygroundWorkspace } from "../playground/PlaygroundShell";
import { copySource, downloadJson } from "../playground/source-export";
import { FsxPreview } from "./FsxPreview";
import type { FsxExample } from "./registry";
import { useFsxSession } from "./use-fsx-session";

function TextEditor(props: {
	readonly label: string;
	readonly value: string;
	readonly onChange: (value: string) => void;
	readonly editor?: RefObject<HTMLTextAreaElement | null>;
	readonly onFocus: () => void;
}) {
	const id = useId();
	return (
		<div>
			<label className="block" htmlFor={id}>
				{props.label}
			</label>
			<textarea
				id={id}
				ref={props.editor}
				onFocus={props.onFocus}
				value={props.value}
				onChange={(event) => props.onChange(event.target.value)}
				rows={14}
				spellCheck={false}
				className="w-full rounded border p-3 font-mono text-sm"
			/>
		</div>
	);
}

function Diagnostics(props: {
	readonly diagnostics: readonly FsxDiagnostic[];
	readonly editor: RefObject<HTMLTextAreaElement | null>;
}) {
	const select = (diagnostic: FsxDiagnostic) => {
		if (!diagnostic.range || !props.editor.current) return;
		props.editor.current.focus();
		props.editor.current.setSelectionRange(diagnostic.range.start, diagnostic.range.end);
	};
	return (
		<ul aria-label="Source diagnostics">
			{props.diagnostics.map((diagnostic, index) => (
				<li key={`${index}-${diagnostic.code}`}>
					<button type="button" onClick={() => select(diagnostic)} disabled={!diagnostic.range}>
						{diagnostic.code}: {diagnostic.message} — {diagnostic.path}{" "}
						{diagnostic.range ? `UTF-16 [${diagnostic.range.start}, ${diagnostic.range.end})` : "(no source range)"}
					</button>
				</li>
			))}
		</ul>
	);
}

export function FsxEditor({ example, demo = false }: { readonly example: FsxExample; readonly demo?: boolean }) {
	const session = useFsxSession(example);
	return <FsxWorkspace example={example} demo={demo} session={session} />;
}

interface WorkspaceProps {
	readonly example: FsxExample;
	readonly demo: boolean;
	readonly session: ReturnType<typeof useFsxSession>;
}

function FsxWorkspace({ example, demo, session }: WorkspaceProps) {
	const { applied } = session;
	return (
		<PlaygroundWorkspace className="gap-6 p-4">
			<section aria-label="FSX sources">
				{demo ? <SourceSummary example={example} /> : <SourcePanel session={session} example={example} />}
			</section>
			<section aria-label="Running preview">
				{applied.result.ok ? (
					<FsxPreview
						key={applied.revision}
						document={applied.result.document}
						onHost={session.onHost}
						owner={session.owner}
					/>
				) : (
					<p role="alert">{applied.result.diagnostics.map(({ message }) => message).join("; ")}</p>
				)}
			</section>
		</PlaygroundWorkspace>
	);
}

function SourceSummary({ example }: { readonly example: FsxExample }) {
	return (
		<details>
			<summary>Source and initial JSON</summary>
			<pre className="overflow-auto whitespace-pre-wrap">{example.source}</pre>
			<pre className="overflow-auto">{JSON.stringify(example.data, null, 2)}</pre>
		</details>
	);
}

function SourcePanel({ session, example }: Omit<WorkspaceProps, "demo">) {
	const editor = useRef<HTMLTextAreaElement>(null);
	const [active, setActive] = useState<"source" | "data">("source");
	return (
		<>
			<TextEditor
				label="FSX source"
				value={session.source}
				onChange={session.setSource}
				editor={editor}
				onFocus={() => setActive("source")}
			/>
			<TextEditor
				label="Initial JSON data"
				value={session.data}
				onChange={session.setData}
				onFocus={() => setActive("data")}
			/>
			<SourceActions session={session} example={example} active={active} />
			<p aria-live="polite">
				Preview: applied revision {session.applied.revision}.{" "}
				{session.dirty ? "Unapplied draft — previous successful preview remains active." : "Source applied."}{" "}
				Source-only Apply preserves live data; edited initial JSON replaces it.
			</p>
			<Diagnostics diagnostics={session.diagnostics} editor={editor} />
		</>
	);
}

function SourceActions({
	session,
	example,
	active,
}: Omit<WorkspaceProps, "demo"> & { readonly active: "source" | "data" }) {
	const [status, setStatus] = useState("");
	return (
		<>
			<PlaygroundToolbar
				onApply={session.apply}
				onReset={session.reset}
				applyLabel="Compile and Apply"
				onCopy={() => copySource(session[active], setStatus)}
				onDownload={() =>
					downloadJson(
						{ format: "fsx-source-and-initial-data", source: session.source, initialJson: session.data },
						`formbar-fsx-${example.id}-draft.json`,
					)
				}
				downloadLabel="Download FSX + initial JSON"
			/>
			<output aria-live="polite">{status}</output>
		</>
	);
}
