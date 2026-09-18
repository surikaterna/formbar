import type { RenderOptions } from "ink";

type StreamListener = () => void;

export interface BrowserOutputStream {
	columns: number;
	rows: number;
	readonly isTTY: true;
	write(value: string): boolean;
	on(event: "resize", listener: StreamListener): void;
	off(event: "resize", listener: StreamListener): void;
	resize(columns: number, rows: number): void;
}

export function createBrowserOutputStream(
	write: (value: string) => void,
	columns: number,
	rows: number,
): BrowserOutputStream {
	const resizeListeners = new Set<StreamListener>();
	return {
		columns,
		rows,
		isTTY: true,
		write(value) {
			write(value);
			return true;
		},
		on(_event, listener) {
			resizeListeners.add(listener);
		},
		off(_event, listener) {
			resizeListeners.delete(listener);
		},
		resize(nextColumns, nextRows) {
			this.columns = nextColumns;
			this.rows = nextRows;
			for (const listener of resizeListeners) listener();
		},
	};
}

export const browserInputStream = { isTTY: false };

export function createInkBrowserOptions(output: BrowserOutputStream): RenderOptions {
	assertInkOutputStream(output);
	assertInkInputStream(browserInputStream);
	const options = {
		stdout: output,
		stderr: output,
		stdin: browserInputStream,
		exitOnCtrlC: false,
		patchConsole: false,
		maxFps: 60,
	};
	// Node stream types are nominal; this browser adapter implements only Ink's observed public render contract.
	return options as unknown as RenderOptions;
}

export function assertInkOutputStream(value: unknown): asserts value is BrowserOutputStream {
	if (!value || typeof value !== "object") throw new TypeError("Ink output stream must be an object");
	const stream = value as Partial<BrowserOutputStream>;
	if (typeof stream.write !== "function") throw new TypeError("Ink output stream requires write");
	if (typeof stream.on !== "function") throw new TypeError("Ink output stream requires on");
	if (typeof stream.off !== "function") throw new TypeError("Ink output stream requires off");
	if (!Number.isFinite(stream.columns)) throw new TypeError("Ink output stream requires columns");
	if (!Number.isFinite(stream.rows)) throw new TypeError("Ink output stream requires rows");
	if (typeof stream.isTTY !== "boolean") throw new TypeError("Ink output stream requires isTTY");
}

function assertInkInputStream(value: unknown): asserts value is { readonly isTTY: boolean } {
	if (!value || typeof value !== "object" || typeof (value as { isTTY?: unknown }).isTTY !== "boolean") {
		throw new TypeError("Ink input stream requires isTTY");
	}
}
