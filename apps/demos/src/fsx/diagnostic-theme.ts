import { EditorView } from "@codemirror/view";

export const diagnosticAppearance = EditorView.theme({
	".cm-fsx-gutter-tooltip:focus-visible": { outline: "2px solid #f8fafc", outlineOffset: "2px" },
	".cm-fsx-error-gutter": { width: "1.4em" },
	".cm-fsx-error-gutter .cm-gutterElement": { padding: ".2em" },
	".cm-fsx-lint-marker": {
		width: "1em",
		height: "1em",
		padding: "0",
		border: "none",
		borderRadius: "50%",
		backgroundColor: "#fca5a5",
		color: "#0f172a",
		fontWeight: "bold",
		fontSize: "inherit",
		lineHeight: "1",
		cursor: "help",
	},
	".cm-fsx-lint-marker:focus-visible": { outline: "2px solid #f8fafc", outlineOffset: "2px" },
	".cm-lintRange-error": {
		backgroundImage: "none",
		textDecoration: "underline wavy #fca5a5",
		textUnderlineOffset: "3px",
	},
	".cm-lintPoint-error:after": { borderBottomColor: "#fca5a5" },
	".cm-gutters": { backgroundColor: "#0f172a", color: "#fca5a5", borderRightColor: "#334155" },
	".cm-tooltip-lint": { backgroundColor: "#0f172a", color: "#f8fafc", border: "1px solid #64748b" },
	".cm-diagnostic-error": { borderLeftColor: "#fca5a5" },
});
