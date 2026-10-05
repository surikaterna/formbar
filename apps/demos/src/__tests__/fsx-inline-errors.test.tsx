// @vitest-environment jsdom
import { redo, undo } from "@codemirror/commands";
import { diagnosticCount, forEachDiagnostic } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { StrictMode, act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FsxSourceEditor, type FsxSourceHandle } from "../fsx/FsxSourceEditor";
import { applyFsx } from "../fsx/compile";
import { fsxExamples } from "../fsx/registry";
import { type SourceDiagnosticReport, sourceLint, sourceRange } from "../fsx/source-diagnostics";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const cleanups: (() => void)[] = [];
beforeEach(() => {
	// jsdom lacks layout; browser tests cover actual underline/gutter/hover geometry.
	const createRange = document.createRange.bind(document);
	vi.spyOn(document, "createRange").mockImplementation(() =>
		Object.assign(createRange(), {
			getClientRects: () => Object.assign([], { item: () => null }),
			getBoundingClientRect: () => new DOMRect(),
		}),
	);
});
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

function failed(source: string): SourceDiagnosticReport {
	const data = JSON.stringify(fsxExamples[0].data);
	const result = applyFsx(fsxExamples[0], source, data);
	if (result.ok) throw new Error("Expected real failed compilation");
	return { source, data, diagnostics: result.diagnostics };
}

function mount(report: SourceDiagnosticReport) {
	const parent = document.createElement("div");
	document.body.append(parent);
	const root = createRoot(parent);
	const editor = createRef<FsxSourceHandle>();
	const onChange = vi.fn();
	const onApply = vi.fn();
	const render = (value: string, diagnosticReport: SourceDiagnosticReport | undefined, data = report.data) =>
		act(() =>
			root.render(
				<StrictMode>
					<FsxSourceEditor
						value={value}
						data={data}
						diagnosticReport={diagnosticReport}
						onChange={onChange}
						onApply={onApply}
						onFocus={() => {}}
						editor={editor}
					/>
				</StrictMode>,
			),
		);
	render(report.source, report);
	const dom = parent.querySelector<HTMLElement>(".cm-editor");
	const view = dom && EditorView.findFromDOM(dom);
	if (!view) throw new Error("Missing editor");
	cleanups.push(() => {
		act(() => root.unmount());
		parent.remove();
		expect(editor.current).toBeNull();
	});
	return { view, editor, render, onChange, onApply, parent };
}

const invalid = fsxExamples[0].source.replace("value={name}", "value={missing}");

function mouse(target: Element | null, event: "mouseenter" | "mouseleave") {
	if (!target) throw new Error("Missing hover surface");
	act(() => target.dispatchEvent(new MouseEvent(event)));
}

it("grace permits content transfer, retaining pointer or focus until both interactions end", () => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	const { parent, view } = mount(failed(invalid));
	const marker = parent.querySelector(".cm-lint-marker-error");
	mouse(marker, "mouseenter");
	act(() => vi.advanceTimersByTime(300));
	const content = parent.querySelector<HTMLDivElement>(".cm-fsx-gutter-tooltip");
	mouse(marker, "mouseleave");
	act(() => vi.advanceTimersByTime(100));
	mouse(content, "mouseenter");
	act(() => vi.advanceTimersByTime(700));
	expect(content?.isConnected).toBe(true);
	act(() => content?.focus());
	mouse(content, "mouseleave");
	act(() => vi.advanceTimersByTime(700));
	expect(content?.isConnected).toBe(true);
	act(() => view.focus());
	act(() => vi.advanceTimersByTime(300));
	expect(parent.querySelector(".cm-fsx-gutter-tooltip")).toBeNull();
});

it("Escape cancels pending or visible hover without restarting for unchanged focus", () => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	const { parent } = mount(failed(invalid));
	const marker = parent.querySelector<HTMLButtonElement>(".cm-lint-marker-error");
	const pressEscape = () => {
		const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
		act(() => document.dispatchEvent(event));
		return event.defaultPrevented;
	};
	mouse(marker, "mouseenter");
	expect(pressEscape()).toBe(true);
	act(() => vi.advanceTimersByTime(700));
	expect(parent.querySelector(".cm-fsx-gutter-tooltip")).toBeNull();
	expect(pressEscape()).toBe(false);
	act(() => marker?.focus());
	act(() => vi.advanceTimersByTime(0));
	expect(parent.querySelector(".cm-fsx-gutter-tooltip")).not.toBeNull();
	expect(pressEscape()).toBe(true);
	act(() => marker?.focus());
	act(() => vi.advanceTimersByTime(700));
	expect(parent.querySelector(".cm-fsx-gutter-tooltip")).toBeNull();
	expect(pressEscape()).toBe(false);
});

it("report replacement and disposal cancel closing grace and detach content/Escape handlers", () => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	const report = failed(invalid);
	const { parent, render } = mount(report);
	const baseline = vi.getTimerCount();
	const marker = parent.querySelector(".cm-lint-marker-error");
	mouse(marker, "mouseenter");
	act(() => vi.advanceTimersByTime(300));
	const retired = parent.querySelector(".cm-fsx-gutter-tooltip");
	mouse(marker, "mouseleave");
	expect(vi.getTimerCount()).toBe(baseline + 1);
	render(invalid, failed(invalid));
	expect(vi.getTimerCount()).toBe(baseline);
	if (!retired) throw new Error("Missing retired content");
	parent.append(retired);
	mouse(retired, "mouseenter");
	const key = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
	document.dispatchEvent(key);
	expect(key.defaultPrevented).toBe(false);
	expect(vi.getTimerCount()).toBe(baseline);
	retired.remove();
	const next = parent.querySelector(".cm-lint-marker-error");
	mouse(next, "mouseenter");
	act(() => vi.advanceTimersByTime(300));
	mouse(next, "mouseleave");
	cleanups.pop()?.();
	expect(vi.getTimerCount()).toBe(0);
	act(() => vi.advanceTimersByTime(700));
});

it("cancels pending gutter work synchronously on invalidation and unmount", () => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	const { parent, editor, render } = mount(failed(invalid));
	const pendingBefore = vi.getTimerCount();
	const hover = () => parent.querySelector(".cm-lint-marker-error")?.dispatchEvent(new MouseEvent("mouseenter"));
	act(hover);
	expect(vi.getTimerCount()).toBe(pendingBefore + 1);
	act(() => editor.current?.clearDiagnostics());
	expect(vi.getTimerCount()).toBe(pendingBefore);
	act(() => vi.advanceTimersByTime(700));
	expect(parent.querySelector(".cm-tooltip-lint")).toBeNull();
	render(invalid, failed(invalid));
	act(hover);
	expect(vi.getTimerCount()).toBe(pendingBefore + 1);
	const retiredMarker = parent.querySelector(".cm-lint-marker-error");
	cleanups.pop()?.();
	retiredMarker?.dispatchEvent(new MouseEvent("mouseenter"));
	expect(vi.getTimerCount()).toBe(0);
	act(() => vi.advanceTimersByTime(700));
});

it("diagnostic replacement clears active gutter hover and fresh keyboard focus safely shows current text", () => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	const first = failed(invalid);
	const { parent, render } = mount(first);
	const focus = () => parent.querySelector<HTMLButtonElement>(".cm-lint-marker-error")?.focus();
	act(focus);
	act(() => vi.advanceTimersByTime(0));
	expect(parent.querySelector(".cm-tooltip-lint")?.textContent).toContain("missing");
	const message = "<img src=x> current report";
	render(invalid, { ...first, diagnostics: first.diagnostics.map((entry) => ({ ...entry, message })) });
	expect(parent.querySelector(".cm-tooltip-lint")).toBeNull();
	act(() => vi.advanceTimersByTime(700));
	expect(parent.querySelector(".cm-tooltip-lint")).toBeNull();
	act(focus);
	act(() => vi.advanceTimersByTime(0));
	expect(parent.querySelector(".cm-tooltip-lint")?.textContent).toBe(message);
	expect(parent.querySelector(".cm-tooltip-lint img")).toBeNull();
});

it("renders real failed Apply diagnostics and selects exactly the compiler's mapped range", () => {
	const report = failed(invalid);
	const { view, editor, parent } = mount(report);
	expect(diagnosticCount(view.state)).toBe(report.diagnostics.length);
	expect(parent.querySelector(".cm-lintRange-error")).not.toBeNull();
	expect(parent.querySelector(".cm-lint-marker-error")).not.toBeNull();
	const diagnostic = report.diagnostics[0];
	if (!diagnostic.range) throw new Error("Missing range");
	act(() => editor.current?.select(diagnostic.range?.start ?? 0, diagnostic.range?.end ?? 0));
	const mapped = sourceRange(report.source, diagnostic.range);
	expect(view.state.selection.main.from).toBe(mapped?.from);
	expect(view.state.selection.main.to).toBe(mapped?.to);
	forEachDiagnostic(view.state, (entry, from, to) => {
		expect(entry.message).toBe(diagnostic.message);
		expect(view.state.sliceDoc(from, to)).toBe(report.source.slice(diagnostic.range?.start, diagnostic.range?.end));
	});
});

it("clears in the editing transaction before asynchronous React callbacks, and undo/redo cannot resurrect it", () => {
	const report = failed(invalid);
	const { view, render, onChange, onApply, editor } = mount(report);
	act(() => view.dispatch({ changes: { from: 0, insert: " " } }));
	expect(onChange).toHaveBeenCalled();
	expect(onApply).not.toHaveBeenCalled();
	expect(diagnosticCount(view.state)).toBe(0);
	act(() => undo(view));
	expect(diagnosticCount(view.state)).toBe(0);
	render(report.source, report);
	expect(diagnosticCount(view.state)).toBe(0);
	render(report.source, failed(report.source));
	expect(diagnosticCount(view.state)).toBeGreaterThan(0);
	act(() => redo(view));
	expect(diagnosticCount(view.state)).toBe(0);
	act(() => editor.current?.clearDiagnostics());
});

it("does not navigate stale/invalid ranges and shortcuts read the editor rather than lagging props", () => {
	const report = failed(invalid);
	const { view, editor, onApply } = mount(report);
	const before = view.state.selection.main;
	act(() => editor.current?.select(-1, 500_000));
	expect(view.state.selection.main).toEqual(before);
	act(() => view.dispatch({ changes: { from: 0, insert: " " } }));
	const after = view.state.selection.main;
	act(() => editor.current?.select(0, 5));
	expect(view.state.selection.main).toEqual(after);
	act(() =>
		view.contentDOM.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Enter",
				code: "Enter",
				ctrlKey: true,
				bubbles: true,
				cancelable: true,
			}),
		),
	);
	expect(onApply).toHaveBeenCalledExactlyOnceWith(` ${report.source}`);
});

it("rejects mismatched source/data, clears successful Apply, and allows a fresh reapply at a new range", () => {
	const report = failed(invalid);
	const { view, render } = mount(report);
	render(report.source, report, "{}");
	expect(diagnosticCount(view.state)).toBe(0);
	render(fsxExamples[0].source, report);
	expect(diagnosticCount(view.state)).toBe(0);
	render(fsxExamples[0].source, undefined);
	expect(diagnosticCount(view.state)).toBe(0);
	const next = failed(`\r\n${invalid.replace(/\n/g, "\r\n")}`);
	render(next.source, undefined);
	render(next.source, next);
	expect(diagnosticCount(view.state)).toBeGreaterThan(0);
	forEachDiagnostic(view.state, (_entry, from) => expect(from).toBe(sourceLint(next)[0].from));
});

it("preserves UTF-16 astral units, normalizes CRLF, and leaves zero-width EOF as a point", () => {
	const text = "😀\r\nabc\r\n";
	expect(sourceRange(text, { start: 4, end: 7 })).toEqual({ from: 3, to: 6 });
	expect(sourceRange(text, { start: text.length, end: text.length })).toEqual({ from: 7, to: 7 });
	const report = {
		source: text,
		data: "{}",
		diagnostics: [{ code: "EOF", path: "root", message: "End", range: { start: 9, end: 9 } }],
	};
	const { parent, view } = mount(report);
	expect(diagnosticCount(view.state)).toBe(1);
	expect(parent.querySelector(".cm-lintPoint-error")).not.toBeNull();
});

it("uses the same exact CRLF/astral compiler range for lint and list selection", () => {
	const report = failed(invalid.replace("Customer", "😀 Customer").replace(/\n/g, "\r\n"));
	const { view, editor } = mount(report);
	const diagnostic = report.diagnostics[0];
	if (!diagnostic.range) throw new Error("Missing compiler range");
	const { start, end } = diagnostic.range;
	act(() => editor.current?.select(start, end));
	expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("missing");
	forEachDiagnostic(view.state, (_entry, from, to) => {
		expect(view.state.sliceDoc(from, to)).toBe("missing");
		expect(view.state.selection.main.from).toBe(from);
		expect(view.state.selection.main.to).toBe(to);
	});
});

it.each([
	{ start: -1, end: 2 },
	{ start: 2, end: 1 },
	{ start: 0, end: 99 },
	{ start: 0.5, end: 2 },
	{ start: 0, end: Number.NaN },
	{ start: 1, end: 2 },
	{ start: 2, end: 3 },
])("fails closed for invalid or split-unit range %j", (range) => {
	expect(sourceRange("😀\r\nx", range)).toBeUndefined();
});

it("keeps JSON/preview, related locations and missing ranges out of the FSX overlay", () => {
	const report = failed(invalid);
	const range = { start: 0, end: 4 };
	const diagnostics = [
		{ code: "JSON", path: "initialData/installation", message: "Invalid JSON", range },
		{ code: "PREVIEW", path: "preview", message: "Failed preview", range },
		{ code: "MISSING", path: "root", message: "No range", related: [{ path: "root.id", message: "Related", range }] },
	];
	const { view } = mount({ ...report, diagnostics });
	expect(diagnosticCount(view.state)).toBe(0);
});
