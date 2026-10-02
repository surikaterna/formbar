// @vitest-environment jsdom
import { EditorView } from "@codemirror/view";
import { StrictMode, act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { FsxSourceEditor, type FsxSourceHandle } from "../fsx/FsxSourceEditor";

const sessions = vi.hoisted(() => [] as { dispose: () => void }[]);
vi.mock("@kalada/codemirror/editor", async (original) => {
	const module = await original<typeof import("@kalada/codemirror/editor")>();
	return {
		...module,
		createEditorSession: (options: Parameters<typeof module.createEditorSession>[0]) => {
			const session = module.createEditorSession(options);
			vi.spyOn(session, "dispose");
			sessions.push(session);
			return session;
		},
	};
});

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("StrictMode disposes both sessions/views and maps CRLF/astral source ranges without sharing instances", async () => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const destroy = vi.spyOn(EditorView.prototype, "destroy");
	const editor = createRef<FsxSourceHandle>();
	const text = '<Form>\r\n<Output value={"😀"}/>\r\n</Form>';
	try {
		await act(async () =>
			root.render(
				<StrictMode>
					<FsxSourceEditor value={text} onChange={() => {}} onApply={() => {}} onFocus={() => {}} editor={editor} />
				</StrictMode>,
			),
		);
		expect(container.querySelectorAll(".cm-editor")).toHaveLength(1);
		expect(sessions).toHaveLength(2);
		expect(sessions[0].dispose).toHaveBeenCalledOnce();
		const content = container.querySelector<HTMLElement>(".cm-content");
		if (!content) throw new Error("Missing source editor");
		const view = EditorView.findFromDOM(content);
		await act(async () => editor.current?.select(text.indexOf("😀"), text.indexOf("😀") + 2));
		expect(view?.state.selection.main.from).toBe(text.indexOf("😀") - 1);
		expect(view?.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("😀");
	} finally {
		await act(async () => root.unmount());
		container.remove();
	}
	expect(editor.current).toBeNull();
	expect(sessions[1].dispose).toHaveBeenCalledOnce();
	expect(destroy).toHaveBeenCalledTimes(2);
	destroy.mockRestore();
});
