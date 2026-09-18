import { describe, expect, it, vi } from "vitest";
import { createSequenceRouter } from "../sequence-router.js";

function fixture() {
	const actions: string[] = [];
	const text: string[] = [];
	const router = createSequenceRouter({
		dispatch: (input) => {
			actions.push(input);
			return input === "space";
		},
		emitText: (value) => text.push(value),
	});
	return { actions, text, router };
}

describe("browser sequence router", () => {
	it("buffers split CSI and keeps controls out of text", () => {
		const { actions, text, router } = fixture();
		router.push("\x1b[");
		router.push("A\r\x7f\x1b[3~\x13");
		expect(actions).toEqual(["arrow-up", "enter", "backspace", "delete-forward", "form-submit"]);
		expect(text).toEqual([]);
	});

	it("routes printable Unicode and multi-character paste together", () => {
		const { text, router } = fixture();
		router.push("Zoë 🚀 paste");
		expect(text).toEqual(["Zoë 🚀 paste"]);
	});

	it("preserves UTF-16 text boundaries next to controls across chunks", () => {
		const { actions, text, router } = fixture();
		router.push("👩‍💻e\u0301");
		router.push("🚀\t");
		router.push("🧑🏽‍🚀\r終");
		expect(text).toEqual(["👩‍💻e\u0301", "🚀", "🧑🏽‍🚀", "終"]);
		expect(actions).toEqual(["tab", "enter"]);
	});

	it("buffers a surrogate pair split across chunks before a control", () => {
		const { actions, text, router } = fixture();
		router.push("\uD83D");
		expect(text).toEqual([]);
		router.push("\uDE80\t");
		expect(text).toEqual(["🚀"]);
		expect(actions).toEqual(["tab"]);
	});

	it("frames bracketed paste as one text event without interpreting controls", () => {
		const { actions, text, router } = fixture();
		router.push("\x1b[20");
		router.push("0~line one\nline\ttwo\x1b[20");
		router.push("1~\r");
		expect(text).toEqual(["line one\nline\ttwo"]);
		expect(actions).toEqual(["enter"]);
	});

	it("routes explicit clipboard paste and IME text as whole chunks", () => {
		const { actions, text, router } = fixture();
		router.paste("clipboard\n\t\x13payload");
		router.push("変換済み👩‍💻");
		expect(text).toEqual(["clipboard\n\t\x13payload", "変換済み👩‍💻"]);
		expect(actions).toEqual([]);
	});

	it("uses text fallback only when space is unhandled", () => {
		const actions: string[] = [];
		const text: string[] = [];
		const router = createSequenceRouter({
			dispatch: (input) => {
				actions.push(input);
				return false;
			},
			emitText: (value) => text.push(value),
		});
		router.push(" ");
		expect(actions).toEqual(["space"]);
		expect(text).toEqual([" "]);
	});

	it("distinguishes Escape from a split escape sequence", () => {
		vi.useFakeTimers();
		const { actions, router } = fixture();
		router.push("\x1b");
		vi.advanceTimersByTime(20);
		expect(actions).toEqual(["escape"]);
		router.dispose();
		vi.useRealTimers();
	});
});
