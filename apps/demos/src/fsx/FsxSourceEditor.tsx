import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { setDiagnostics, setDiagnosticsEffect } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { fsxHighlighting } from "@formbar/fsx-editor";
import { type EditorSession, createEditorSession } from "@kalada/codemirror/editor";
import { type RefObject, useEffect, useId, useRef } from "react";
import { diagnosticAppearance } from "./diagnostic-theme";
import { type SourceDiagnosticReport, sourceLint, sourceRange } from "./source-diagnostics";
import { sourceErrorGutter } from "./source-gutter";
import { sourceAppearance } from "./source-theme";

export interface FsxSourceHandle {
	readonly select: (from: number, to: number) => void;
	readonly clearDiagnostics: () => void;
}

interface Props {
	readonly value: string;
	readonly data?: string;
	readonly diagnosticReport?: SourceDiagnosticReport;
	readonly onChange: (text: string) => void;
	readonly onApply: (text: string) => void;
	readonly onFocus: () => void;
	readonly editor: RefObject<FsxSourceHandle | null>;
}

function selectSource(view: EditorView, session: EditorSession, from: number, to: number) {
	const text = session.getSnapshot().text;
	const range = sourceRange(text, { start: from, end: to });
	if (!range) return;
	view.dispatch({ selection: { anchor: range.from, head: range.to }, scrollIntoView: true });
	view.focus();
}

function sourceExtensions(id: string, callbacks: RefObject<Props>, session: EditorSession) {
	const apply = () => {
		callbacks.current.onApply(session.getSnapshot().text);
		return true;
	};
	return [
		session.extension,
		fsxHighlighting(),
		history(),
		keymap.of([
			{ key: "Ctrl-Enter", run: apply, preventDefault: true },
			{ key: "Mod-Enter", run: apply, preventDefault: true },
			...defaultKeymap,
			...historyKeymap,
		]),
		EditorState.transactionExtender.of((transaction) =>
			transaction.docChanged ? { effects: setDiagnosticsEffect.of([]) } : null,
		),
		EditorView.contentAttributes.of({ "aria-labelledby": id, spellcheck: "false" }),
		EditorView.domEventHandlers({ focus: () => callbacks.current.onFocus() }),
		EditorView.lineWrapping,
		sourceAppearance,
		sourceErrorGutter,
		diagnosticAppearance,
	];
}

function mountEditor(parent: HTMLElement, id: string, callbacks: RefObject<Props>) {
	// Undo can restore identical bytes before React catches up; only a fresh Apply report may restore lint.
	let blocked: SourceDiagnosticReport | undefined;
	const clearDiagnostics = () => {
		blocked = callbacks.current.diagnosticReport;
		view.dispatch(setDiagnostics(view.state, []));
	};
	const session = createEditorSession({
		document: { uri: `memory:///formbar/${id}.fsx`, version: 1, text: callbacks.current.value },
		ariaLabel: "FSX source",
		onDocumentChange: ({ text }) => {
			blocked = callbacks.current.diagnosticReport;
			callbacks.current.onChange(text);
		},
	});
	const view = new EditorView({
		parent,
		doc: session.getSnapshot().text,
		extensions: sourceExtensions(id, callbacks, session),
	});
	const currentReport = (
		report = callbacks.current.diagnosticReport,
		value = callbacks.current.value,
		data = callbacks.current.data,
	) => {
		return report &&
			report !== blocked &&
			report.source === value &&
			report.data === data &&
			report.source === session.getSnapshot().text
			? report
			: undefined;
	};
	return { session, view, clearDiagnostics, currentReport };
}

export function FsxSourceEditor(props: Props) {
	const id = useId();
	const parent = useRef<HTMLDivElement>(null);
	const callbacks = useRef(props);
	callbacks.current = props;
	const mounted = useRef<ReturnType<typeof mountEditor> | null>(null);
	useEffect(() => {
		if (!parent.current) return;
		const current = mountEditor(parent.current, id, callbacks);
		mounted.current = current;
		props.editor.current = {
			select: (from, to) => {
				if (current.currentReport()) selectSource(current.view, current.session, from, to);
			},
			clearDiagnostics: current.clearDiagnostics,
		};
		return () => {
			props.editor.current = null;
			mounted.current = null;
			current.view.destroy();
			current.session.dispose();
		};
	}, [id, props.editor]);
	useEffect(() => {
		const session = mounted.current?.session;
		if (session && session.getSnapshot().text !== props.value) session.replaceDocument(props.value);
	}, [props.value]);
	useEffect(() => {
		const current = mounted.current;
		if (!current) return;
		const report = current.currentReport(props.diagnosticReport, props.value, props.data);
		current.view.dispatch(setDiagnostics(current.view.state, report ? sourceLint(report) : []));
	}, [props.diagnosticReport, props.value, props.data]);
	return (
		<div>
			<span className="block" id={id}>
				FSX source
			</span>
			<div ref={parent} className="rounded border" />
		</div>
	);
}
