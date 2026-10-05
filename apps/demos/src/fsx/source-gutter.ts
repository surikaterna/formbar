import { type Diagnostic, setDiagnosticsEffect } from "@codemirror/lint";
import { RangeSet, StateEffect, StateField, type Text, type Transaction } from "@codemirror/state";
import {
	type EditorView,
	GutterMarker,
	type Tooltip,
	ViewPlugin,
	type ViewUpdate,
	gutter,
	showTooltip,
} from "@codemirror/view";

const setTooltip = StateEffect.define<Tooltip | null>();
type Interaction = "pointer" | "focus";

class ErrorMarker extends GutterMarker {
	constructor(readonly diagnostics: readonly Diagnostic[]) {
		super();
	}
	toDOM(view: EditorView) {
		const marker = view.dom.ownerDocument.createElement("button");
		marker.type = "button";
		marker.className = "cm-lint-marker-error cm-fsx-lint-marker";
		marker.textContent = "!";
		marker.setAttribute("aria-label", this.diagnostics.map(({ message }) => message).join("; "));
		marker.onmouseenter = () => view.plugin(hover)?.start(marker, this.diagnostics, 300);
		marker.onfocus = () => view.plugin(hover)?.start(marker, this.diagnostics, 0);
		marker.onmouseleave = () => view.plugin(hover)?.leave(marker, "pointer");
		marker.onblur = () => view.plugin(hover)?.leave(marker, "focus");
		return marker;
	}
}

function markersFor(doc: Text, diagnostics: readonly Diagnostic[]) {
	const lines = new Map<number, Diagnostic[]>();
	for (const diagnostic of diagnostics) {
		const from = doc.lineAt(diagnostic.from).from;
		lines.set(from, [...(lines.get(from) ?? []), diagnostic]);
	}
	return RangeSet.of(
		[...lines].map(([from, entries]) => new ErrorMarker(entries).range(from)),
		true,
	);
}

interface GutterState {
	readonly markers: RangeSet<ErrorMarker>;
	readonly tooltip: Tooltip | null;
	readonly generation: number;
}

function updateGutter(state: GutterState, transaction: Transaction): GutterState {
	let next = transaction.docChanged
		? { markers: RangeSet.empty, tooltip: null, generation: state.generation + 1 }
		: state;
	for (const effect of transaction.effects) {
		if (effect.is(setDiagnosticsEffect))
			next = {
				markers: markersFor(transaction.state.doc, effect.value),
				tooltip: null,
				generation: next.generation + 1,
			};
		if (effect.is(setTooltip)) next = { ...next, tooltip: effect.value };
	}
	return next;
}

const gutterState = StateField.define<GutterState>({
	create: () => ({ markers: RangeSet.empty, tooltip: null, generation: 0 }),
	update: updateGutter,
	provide: (field) => showTooltip.from(field, ({ tooltip }) => tooltip),
});

function tooltipContent(view: EditorView, diagnostics: readonly Diagnostic[]) {
	const dom = view.dom.ownerDocument.createElement("div");
	dom.className = "cm-tooltip-lint cm-fsx-gutter-tooltip";
	dom.setAttribute("role", "tooltip");
	dom.tabIndex = 0;
	for (const { message } of diagnostics) {
		const entry = dom.appendChild(view.dom.ownerDocument.createElement("div"));
		entry.className = "cm-diagnostic cm-diagnostic-error";
		entry.textContent = message;
	}
	const owner = view.plugin(hover);
	owner?.attachContent(dom);
	dom.onmouseenter = () => owner?.enterContent(dom, "pointer");
	dom.onfocus = () => owner?.enterContent(dom, "focus");
	dom.onmouseleave = () => owner?.leave(dom, "pointer");
	dom.onblur = () => owner?.leave(dom, "focus");
	return dom;
}

function tooltipFor(view: EditorView, marker: HTMLElement, diagnostics: readonly Diagnostic[]): Tooltip {
	return {
		pos: view.state.doc.lineAt(diagnostics[0].from).from,
		above: false,
		clip: false,
		create: () => {
			const dom = tooltipContent(view, diagnostics);
			return {
				dom,
				getCoords: () => marker.getBoundingClientRect(),
				destroy: () => {
					dom.onmouseenter = dom.onmouseleave = dom.onfocus = dom.onblur = null;
					view.plugin(hover)?.releaseContent(dom);
				},
			};
		},
	};
}

class GutterHover {
	private timer: ReturnType<typeof setTimeout> | undefined;
	private closing: ReturnType<typeof setTimeout> | undefined;
	private destroyed = false;
	private marker: HTMLElement | undefined;
	private content: HTMLElement | undefined;
	private pointer = new Set<HTMLElement>();
	private focus = new Set<HTMLElement>();
	private escape = (event: KeyboardEvent) => {
		if (event.key !== "Escape") return;
		event.preventDefault();
		this.dismiss();
	};
	constructor(readonly view: EditorView) {}
	start(marker: HTMLElement, diagnostics: readonly Diagnostic[], delay: number) {
		if (this.destroyed || !marker.isConnected || !this.view.dom.contains(marker)) return;
		if (this.marker !== marker) this.dismiss();
		this.marker = marker;
		if (this.view.dom.ownerDocument.activeElement === marker) this.focus.add(marker);
		this.interact(marker, delay === 0 ? "focus" : "pointer");
		this.view.dom.ownerDocument.addEventListener("keydown", this.escape, true);
		if (this.view.state.field(gutterState).tooltip) return;
		clearTimeout(this.timer);
		const generation = this.view.state.field(gutterState).generation;
		this.timer = setTimeout(() => {
			this.timer = undefined;
			// A removed marker or newer Apply result never authorizes an old delayed hover.
			if (this.destroyed || !marker.isConnected || generation !== this.view.state.field(gutterState).generation) return;
			this.view.dispatch({ effects: setTooltip.of(tooltipFor(this.view, marker, diagnostics)) });
		}, delay);
	}
	attachContent(content: HTMLElement) {
		this.content = content;
	}
	releaseContent(content: HTMLElement) {
		this.pointer.delete(content);
		this.focus.delete(content);
		if (this.content === content) this.content = undefined;
	}
	enterContent(content: HTMLElement, kind: Interaction) {
		if (this.destroyed || content !== this.content || !content.isConnected) return;
		this.interact(content, kind);
	}
	private interact(element: HTMLElement, kind: Interaction) {
		clearTimeout(this.closing);
		this.closing = undefined;
		this[kind].add(element);
	}
	private cancel() {
		clearTimeout(this.timer);
		clearTimeout(this.closing);
		this.timer = undefined;
		this.closing = undefined;
		this.pointer.clear();
		this.focus.clear();
		this.marker = this.content = undefined;
		this.view.dom.ownerDocument.removeEventListener("keydown", this.escape, true);
	}
	leave(element: HTMLElement, kind: Interaction) {
		if (this.destroyed || (element !== this.marker && element !== this.content)) return;
		this[kind].delete(element);
		if (this.pointer.size || this.focus.size) return;
		clearTimeout(this.timer);
		this.timer = undefined;
		if (!this.view.state.field(gutterState).tooltip) return this.cancel();
		// Allow crossing the gap to the content; entering either surface cancels dismissal.
		clearTimeout(this.closing);
		this.closing = setTimeout(() => this.dismiss(), 300);
	}
	private dismiss() {
		this.cancel();
		if (!this.destroyed) this.view.dispatch({ effects: setTooltip.of(null) });
	}
	update(update: ViewUpdate) {
		if (
			update.docChanged ||
			update.transactions.some((tr) => tr.effects.some((effect) => effect.is(setDiagnosticsEffect)))
		)
			this.cancel();
	}
	destroy() {
		this.destroyed = true;
		this.cancel();
	}
}

const hover = ViewPlugin.fromClass(GutterHover);

export const sourceErrorGutter = [
	gutterState,
	hover,
	gutter({ class: "cm-fsx-error-gutter", markers: (view) => view.state.field(gutterState).markers }),
];
