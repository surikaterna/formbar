import type { FsxDiagnostic } from "@formbar/fsx-authoring";
import { type RefObject, useId, useRef } from "react";
import { FsxPreview } from "./FsxPreview";
import type { FsxExample } from "./registry";
import { useFsxSession } from "./use-fsx-session";

function TextEditor(props: {
	readonly label: string;
	readonly value: string;
	readonly onChange: (value: string) => void;
	readonly editor?: RefObject<HTMLTextAreaElement | null>;
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

export function FsxEditor({ example }: { readonly example: FsxExample }) {
	const session = useFsxSession(example);
	const editor = useRef<HTMLTextAreaElement>(null);
	const { applied } = session;
	return (
		<div className="grid gap-6 lg:grid-cols-2">
			<section>
				<TextEditor label="FSX source" value={session.source} onChange={session.setSource} editor={editor} />
				<TextEditor label="Initial JSON data" value={session.data} onChange={session.setData} />
				<div className="flex gap-4 py-3">
					<button type="button" onClick={session.apply}>
						Compile and Apply
					</button>
					<button type="button" onClick={session.reset}>
						Reset example
					</button>
				</div>
				<p aria-live="polite">
					Preview: applied revision {applied.revision}.{" "}
					{session.dirty ? "Unapplied draft — previous successful preview remains active." : "Source applied."}{" "}
					Source-only Apply preserves live data; edited initial JSON replaces it.
				</p>
				<Diagnostics diagnostics={session.diagnostics} editor={editor} />
			</section>
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
		</div>
	);
}
