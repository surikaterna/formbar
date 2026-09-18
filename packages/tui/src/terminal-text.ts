export function isSafeTextChunk(text: string): boolean {
	return text.length > 0 && Array.from(text).every((character) => !isControl(character));
}

export function sanitizeTerminalText(text: string): string {
	return Array.from(text, (character) => (isControl(character) ? "�" : character)).join("");
}

function isControl(character: string): boolean {
	const code = character.codePointAt(0) ?? 0;
	return code <= 31 || (code >= 127 && code <= 159);
}
