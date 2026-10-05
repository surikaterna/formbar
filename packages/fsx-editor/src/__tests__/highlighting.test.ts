import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { analyzeFsxSyntax } from "@formbar/fsx-authoring";
import { expect, it } from "vitest";
import { fsxHighlighting } from "../index.js";

function spans(state: EditorState) {
	const result: { start: number; end: number; kind: string }[] = [];
	for (const set of state.facet(EditorView.decorations)) {
		if (typeof set === "function") continue;
		set.between(0, state.doc.length, (start, end, value) => {
			result.push({ start, end, kind: value.spec.class.replace("cm-fsx-", "") });
		});
	}
	return result;
}

it("matches headless spans in CM positions including CRLF and astral text", () => {
	const state = EditorState.create({
		doc: '<Root a="😀">\r\n<Field value={"}"} />\r\n</Root>',
		extensions: [fsxHighlighting()],
	});
	expect(spans(state)).toEqual(analyzeFsxSyntax(state.doc.toString()).spans);
});

it("recomputes insertion, deletion, malformed guests and whole-document resets", () => {
	let state = EditorState.create({ doc: "<Field />", extensions: [fsxHighlighting()] });
	for (const source of ['<Field a={"}"} />', '<Field a={"} />', "<", '<Root a="new" />']) {
		state = state.update({ changes: { from: 0, to: state.doc.length, insert: source } }).state;
		expect(spans(state)).toEqual(analyzeFsxSyntax(source).spans);
	}
});
