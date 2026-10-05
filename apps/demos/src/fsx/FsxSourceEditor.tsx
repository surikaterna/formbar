import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorView, keymap } from "@codemirror/view";
import { fsxHighlighting } from "@formbar/fsx-editor";
import { type EditorSession, createEditorSession } from "@kalada/codemirror/editor";
import { type RefObject, useEffect, useId, useRef } from "react";

export interface FsxSourceHandle {
	readonly select: (from: number, to: number) => void;
}

interface Props {
	readonly value: string;
	readonly onChange: (text: string) => void;
	readonly onApply: (text: string) => void;
	readonly onFocus: () => void;
	readonly editor: RefObject<FsxSourceHandle | null>;
}

function selectSource(view: EditorView, session: EditorSession, from: number, to: number) {
	const text = session.getSnapshot().text;
	// Compiler offsets include CRLF; CodeMirror document positions count each line break once.
	const position = (offset: number) =>
		text.slice(0, Math.max(0, Math.min(offset, text.length))).replace(/\r\n/g, "\n").length;
	view.dispatch({ selection: { anchor: position(from), head: position(to) }, scrollIntoView: true });
	view.focus();
}

function mountEditor(parent: HTMLElement, id: string, callbacks: RefObject<Props>) {
	const session = createEditorSession({
		document: { uri: `memory:///formbar/${id}.fsx`, version: 1, text: callbacks.current.value },
		ariaLabel: "FSX source",
		onDocumentChange: ({ text }) => callbacks.current.onChange(text),
	});
	const apply = () => {
		callbacks.current.onApply(session.getSnapshot().text);
		return true;
	};
	const view = new EditorView({
		parent,
		doc: session.getSnapshot().text,
		extensions: [
			session.extension,
			fsxHighlighting(),
			history(),
			keymap.of([
				{ key: "Ctrl-Enter", run: apply, preventDefault: true },
				{ key: "Mod-Enter", run: apply, preventDefault: true },
				...defaultKeymap,
				...historyKeymap,
			]),
			EditorView.contentAttributes.of({ "aria-labelledby": id, spellcheck: "false" }),
			EditorView.domEventHandlers({ focus: () => callbacks.current.onFocus() }),
			EditorView.lineWrapping,
			EditorView.theme({
				"&": { fontSize: "14px" },
				".cm-content": { fontFamily: "monospace", minHeight: "18rem" },
				".cm-scroller": { overflow: "auto", maxHeight: "32rem" },
			}),
		],
	});
	return { session, view };
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
		props.editor.current = { select: (from, to) => selectSource(current.view, current.session, from, to) };
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
	return (
		<div>
			<span className="block" id={id}>
				FSX source
			</span>
			<div ref={parent} className="rounded border" />
		</div>
	);
}
