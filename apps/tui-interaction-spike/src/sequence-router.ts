export interface SequenceDestination {
	dispatch(input: string): boolean;
	emitText(text: string): void;
}

const CONTROL_ACTIONS = new Map([
	["\r", "enter"],
	["\n", "enter"],
	["\t", "tab"],
	["\x7f", "backspace"],
	["\b", "backspace"],
	["\x13", "form-submit"],
	["\x1b[A", "arrow-up"],
	["\x1b[B", "arrow-down"],
	["\x1b[C", "arrow-right"],
	["\x1b[D", "arrow-left"],
	["\x1b[3~", "delete-forward"],
]);
const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

export interface SequenceRouter {
	push(data: string): void;
	paste(text: string): void;
	dispose(): void;
}

export function createSequenceRouter(destination: SequenceDestination): SequenceRouter {
	let pending = "";
	let pasteBuffer: string | undefined;
	let escapeTimer: ReturnType<typeof setTimeout> | undefined;
	const flushEscape = () => {
		escapeTimer = undefined;
		if (pending === "\x1b") {
			pending = "";
			destination.dispatch("escape");
		}
	};
	return {
		push(data) {
			if (escapeTimer) clearTimeout(escapeTimer);
			pending += data;
			const trailingSurrogate = /[\uD800-\uDBFF]$/.exec(pending)?.[0] ?? "";
			const routable = trailingSurrogate ? pending.slice(0, -1) : pending;
			({ pending, pasteBuffer } = routeAvailable(routable, pasteBuffer, destination));
			pending += trailingSurrogate;
			if (pending === "\x1b") escapeTimer = setTimeout(flushEscape, 20);
		},
		paste(text) {
			destination.emitText(text);
		},
		dispose() {
			if (escapeTimer) clearTimeout(escapeTimer);
			pending = "";
			pasteBuffer = undefined;
		},
	};
}

interface RouterState {
	readonly pending: string;
	readonly pasteBuffer: string | undefined;
}

function routeAvailable(input: string, paste: string | undefined, destination: SequenceDestination): RouterState {
	let remaining = input;
	let pasteBuffer = paste;
	while (remaining.length > 0) {
		if (pasteBuffer !== undefined) {
			const combined = pasteBuffer + remaining;
			const end = combined.indexOf(PASTE_END);
			if (end < 0) return { pending: "", pasteBuffer: combined };
			destination.emitText(combined.slice(0, end));
			pasteBuffer = undefined;
			remaining = combined.slice(end + PASTE_END.length);
			continue;
		}
		if (remaining.startsWith(PASTE_START)) {
			pasteBuffer = "";
			remaining = remaining.slice(PASTE_START.length);
			continue;
		}
		const match = [...CONTROL_ACTIONS].find(([sequence]) => remaining.startsWith(sequence));
		if (match) {
			destination.dispatch(match[1]);
			remaining = remaining.slice(match[0].length);
			continue;
		}
		if (isIncompleteEscape(remaining)) return { pending: remaining, pasteBuffer };
		if (remaining.startsWith("\x1b")) {
			if (!remaining.startsWith("\x1b[")) {
				destination.dispatch("escape");
				remaining = remaining.slice(1);
				continue;
			}
			remaining = consumeUnknownEscape(remaining);
			continue;
		}
		const boundary = controlBoundary(remaining);
		const text = remaining.slice(0, boundary);
		if (text === " ") routeSpace(destination);
		else if (text.length > 0) destination.emitText(text);
		remaining = remaining.slice(Math.max(boundary, 1));
	}
	return { pending: "", pasteBuffer };
}

function controlBoundary(value: string): number {
	let offset = 0;
	for (const character of value) {
		const code = character.codePointAt(0) ?? 0;
		if (code < 32 || code === 127 || (code >= 128 && code <= 159)) return offset;
		offset += character.length;
	}
	return value.length;
}

function isIncompleteEscape(value: string): boolean {
	return PASTE_START.startsWith(value) || value === "\x1b" || (value.startsWith("\x1b[") && !/[A-Za-z~]$/.test(value));
}

function consumeUnknownEscape(value: string): string {
	const end = value.search(/[A-Za-z~]/);
	return end < 0 ? "" : value.slice(end + 1);
}

function routeSpace(destination: SequenceDestination): void {
	if (!destination.dispatch("space")) destination.emitText(" ");
}
