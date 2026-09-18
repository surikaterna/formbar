import type { StandaloneInput, StandaloneInputKey } from "./standalone-types.js";

const NAMED_KEYS: readonly [keyof StandaloneInputKey, string][] = [
	["return", "enter"],
	["escape", "escape"],
	["tab", "tab"],
	["backspace", "backspace"],
	["delete", "delete-forward"],
	["upArrow", "arrow-up"],
	["downArrow", "arrow-down"],
	["leftArrow", "arrow-left"],
	["rightArrow", "arrow-right"],
	["pageUp", "page-up"],
	["pageDown", "page-down"],
];

/** Converts one Ink input callback into a host action without reading mutable state. */
export function normalizeStandaloneInput(input: string, key: StandaloneInputKey = {}): StandaloneInput | undefined {
	if (key.meta === true && key.escape !== true) return undefined;
	if (key.ctrl === true) return normalizeControl(input, key);
	if (key.shift === true && !isPrintable(input)) return undefined;
	const names = NAMED_KEYS.filter(([flag]) => key[flag] === true);
	if (names.length > 1) return undefined;
	// Ink cannot distinguish terminal DEL from Backspace by flags consistently.
	if (input === "\x7f" || input === "\b") return { kind: "action", input: "backspace" };
	if (names[0]) return { kind: "action", input: names[0][1] };
	if (input === " ") return { kind: "action", input: "space", textFallback: " " };
	return isPrintable(input) ? { kind: "text", text: input } : undefined;
}

function normalizeControl(input: string, key: StandaloneInputKey): StandaloneInput | undefined {
	if (key.shift === true || NAMED_KEYS.some(([flag]) => key[flag] === true)) return undefined;
	if (input.toLowerCase() === "c") return { kind: "exit", reason: "ctrl-c" };
	if (input.toLowerCase() === "s") return { kind: "action", input: "form-submit" };
	return undefined;
}

function isPrintable(input: string): boolean {
	return (
		input.length > 0 &&
		[...input].every((character) => {
			const code = character.codePointAt(0) ?? 0;
			return code >= 32 && code !== 127 && !(code >= 128 && code <= 159);
		})
	);
}
