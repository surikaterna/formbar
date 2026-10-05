// @vitest-environment jsdom
import { EditorView } from "@codemirror/view";
import { StrictMode, act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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

const errors: ErrorEvent[] = [];
const onError = (event: ErrorEvent) => errors.push(event);
let restoreRange: () => void;
let clientRects: ReturnType<typeof vi.fn>;

function installRangeGeometry() {
	const methods = ["getClientRects", "getBoundingClientRect"] as const;
	const originals = methods.map((method) => Object.getOwnPropertyDescriptor(Range.prototype, method));
	// jsdom has no layout. These stand-ins exercise measurement; Chromium owns geometry assertions.
	const rect = new DOMRect(0, 0, 8, 16);
	clientRects = vi.fn(() => Object.assign([rect], { item: (index: number) => (index === 0 ? rect : null) }));
	Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: clientRects });
	Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: vi.fn(() => rect) });
	return () => {
		methods.forEach((method, index) => {
			const original = originals[index];
			if (original) Object.defineProperty(Range.prototype, method, original);
			else Reflect.deleteProperty(Range.prototype, method);
		});
	};
}

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
	restoreRange = installRangeGeometry();
	errors.length = 0;
	window.addEventListener("error", onError);
});

afterEach(() => {
	window.removeEventListener("error", onError);
	restoreRange();
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	sessions.length = 0;
});

async function selectAstralSource(container: HTMLElement, editor: { current: FsxSourceHandle | null }, text: string) {
	const content = container.querySelector<HTMLElement>(".cm-content");
	if (!content) throw new Error("Missing source editor");
	const view = EditorView.findFromDOM(content);
	await act(async () => editor.current?.select(text.indexOf("😀"), text.indexOf("😀") + 2));
	expect(view?.state.selection.main.from).toBe(text.indexOf("😀") - 1);
	expect(view?.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("😀");
}

function diagnosticProps(text: string, editor: ReturnType<typeof createRef<FsxSourceHandle>>) {
	return {
		value: text,
		data: "{}",
		diagnosticReport: { source: text, data: "{}", diagnostics: [] },
		onChange: () => {},
		onApply: () => {},
		onFocus: () => {},
		editor,
	};
}

it.each([16, 100, 1000])(
	"StrictMode disposes both sessions/views and maps CRLF/astral source ranges after %ims of measurement",
	async (delay) => {
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
						<FsxSourceEditor {...diagnosticProps(text, editor)} />
					</StrictMode>,
				),
			);
			expect(container.querySelectorAll(".cm-editor")).toHaveLength(1);
			expect(sessions).toHaveLength(2);
			expect(sessions[0].dispose).toHaveBeenCalledOnce();
			await selectAstralSource(container, editor, text);
			await act(async () => vi.advanceTimersByTimeAsync(delay));
			expect(clientRects).toHaveBeenCalled();
		} finally {
			await act(async () => root.unmount());
			container.remove();
		}
		const measurements = clientRects.mock.calls.length;
		await act(async () => vi.advanceTimersByTimeAsync(1000));
		expect(clientRects).toHaveBeenCalledTimes(measurements);
		expect(vi.getTimerCount()).toBe(0);
		expect(errors).toEqual([]);
		expect(editor.current).toBeNull();
		expect(sessions[1].dispose).toHaveBeenCalledOnce();
		expect(destroy).toHaveBeenCalledTimes(2);
	},
);
