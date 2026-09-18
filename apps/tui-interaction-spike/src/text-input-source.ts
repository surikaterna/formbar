import type { InteractionCleanup, TextInputSource } from "@formbar/tui";

export interface WritableTextInputSource extends TextInputSource {
	emit(text: string): void;
}

export function createTextInputSource(): WritableTextInputSource {
	const listeners = new Set<(text: string) => void>();
	return {
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		emit(text) {
			for (const listener of listeners) listener(text);
		},
	};
}

export const noTextInput: TextInputSource = { subscribe: (): InteractionCleanup => () => undefined };
