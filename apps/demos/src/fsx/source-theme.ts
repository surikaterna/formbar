import { EditorView, drawSelection } from "@codemirror/view";

// The demo owns a fixed dark palette, independent of the system preference.
export const sourceAppearance = [
	drawSelection(),
	EditorView.theme(
		{
			"&": { fontSize: "14px", color: "var(--foreground)", backgroundColor: "var(--surface-inset)" },
			".cm-content": { fontFamily: "monospace", caretColor: "var(--foreground)" },
			".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)", borderLeftWidth: "2px" },
			".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
				backgroundColor: "#334155",
			},
			".cm-content ::selection": { backgroundColor: "#334155" },
			".cm-fsx-tag": { color: "#93c5fd" },
			".cm-fsx-attribute": { color: "#d8b4fe" },
			".cm-fsx-string": { color: "#86efac" },
			".cm-fsx-punctuation": { color: "#cbd5e1" },
			".cm-scroller": { overflow: "auto", height: "28rem" },
			"@media (max-width: 48rem)": {
				".cm-scroller": { height: "clamp(20rem, 55svh, 28rem)" },
			},
		},
		{ dark: true },
	),
];
