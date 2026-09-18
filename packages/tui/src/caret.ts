import type { MutableEditState } from "./edit-state.js";

export function graphemes(value: string): string[] {
	return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)].map(({ segment }) => segment);
}

export function insertAtCaret(value: string, inserted: string, caret: number): string {
	const parts = graphemes(value);
	parts.splice(caret, 0, inserted);
	return parts.join("");
}

export function removeBefore(state: MutableEditState, key: "draft" | "search"): void {
	if (state.caret === 0) return;
	const parts = graphemes(state[key]);
	parts.splice(state.caret - 1, 1);
	state[key] = parts.join("");
	state.caret -= 1;
}

export function removeAt(state: MutableEditState, key: "draft" | "search"): void {
	const parts = graphemes(state[key]);
	parts.splice(state.caret, 1);
	state[key] = parts.join("");
	state.caret = Math.min(state.caret, parts.length);
}

export function moveCaret(state: MutableEditState, delta: number): void {
	const value = state.mode === "select" ? state.search : state.draft;
	state.caret = Math.max(0, Math.min(graphemes(value).length, state.caret + delta));
}

export function renderCaret(value: string, caret: number, masked = false): string {
	const source = graphemes(value);
	const parts = masked ? source.map(() => "•") : source.map(sanitizeTerminalText);
	parts.splice(Math.max(0, Math.min(parts.length, caret)), 0, "│");
	return parts.join("");
}
import { sanitizeTerminalText } from "./terminal-text.js";
