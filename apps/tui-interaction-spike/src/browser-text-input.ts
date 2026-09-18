import type { TextInputSource } from "@formbar/tui";

export interface BrowserTextInput extends TextInputSource {
	emit(text: string): void;
	listenerCount(): number;
	dispose(): void;
}

export function createBrowserTextInput(): BrowserTextInput {
	const listeners = new Set<(text: string) => void>();
	return {
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		emit(text) {
			for (const listener of listeners) listener(text);
		},
		listenerCount: () => listeners.size,
		dispose: () => listeners.clear(),
	};
}
