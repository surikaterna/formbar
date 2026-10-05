import { type Extension, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { analyzeFsxSyntax } from "@formbar/fsx-authoring";

function decorations(source: string): DecorationSet {
	return Decoration.set(
		analyzeFsxSyntax(source).spans.map(({ start, end, kind }) =>
			Decoration.mark({ class: `cm-fsx-${kind}` }).range(start, end),
		),
	);
}

const highlighting = StateField.define<DecorationSet>({
	// Analyze the LF document representation: CM counts CRLF as one position, astral chars as two.
	create: (state) => decorations(state.doc.toString()),
	update: (value, transaction) => (transaction.docChanged ? decorations(transaction.state.doc.toString()) : value),
	provide: (field) => EditorView.decorations.from(field),
});

/** Host-only syntax highlighting; guest contents and all semantic decisions remain unstyled. */
export function fsxHighlighting(): Extension {
	return [
		highlighting,
		EditorView.baseTheme({
			".cm-fsx-tag": { color: "#2563eb" },
			".cm-fsx-attribute": { color: "#9333ea" },
			".cm-fsx-string": { color: "#15803d" },
			".cm-fsx-punctuation": { color: "#64748b" },
		}),
	];
}
