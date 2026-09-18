import type { FormApi } from "@formbar/core";
import type { SchemaFormResult } from "@formbar/from-schema";
import { FormbarTui } from "@formbar/tui";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { render } from "ink";
import { useEffect, useRef } from "react";
import { createCleanupTransaction, disposeInkInstance, notifySafely } from "./browser-mount.js";
import { createBrowserOutputStream, createInkBrowserOptions } from "./browser-streams.js";
import { createBrowserTextInput } from "./browser-text-input.js";
import { scheduleDisposal } from "./deferred-disposal.js";
import { createMemoryInteractionEngine } from "./memory-engine.js";
import { createSequenceRouter } from "./sequence-router.js";

export interface TerminalMetrics {
	readonly columns: number;
	readonly rows: number;
	readonly output: string;
	readonly textListeners: number;
	readonly active: boolean;
}

export interface TuiTerminalPanelProps {
	readonly form: FormApi<Record<string, unknown>, unknown>;
	readonly schema: SchemaFormResult;
	readonly onMetrics: (metrics: TerminalMetrics) => void;
	readonly onController: (controller: TerminalController | undefined) => void;
	readonly onLifecycleError?: (error: unknown) => void;
}

export interface TerminalController {
	resize(columns: number, rows: number): void;
}

export default function TuiTerminalPanel(props: TuiTerminalPanelProps) {
	const host = useRef<HTMLDivElement>(null);
	const { form, schema, onMetrics, onController, onLifecycleError } = props;
	useEffect(() => {
		if (!host.current) return;
		return mountTerminal(host.current, { form, schema, onMetrics, onController, onLifecycleError });
	}, [form, schema, onMetrics, onController, onLifecycleError]);
	return <div ref={host} className="terminal" aria-label="Formbar terminal" />;
}

function mountTerminal(host: HTMLDivElement, props: TuiTerminalPanelProps): () => void {
	const transaction = createCleanupTransaction();
	try {
		return acquireTerminal(host, props, transaction, (terminal) => {
			scheduleDisposal(
				() => terminal.dispose(),
				(error) => reportError(props, error),
			);
		});
	} catch (error) {
		return transaction.rollback(error);
	}
}

function acquireTerminal(
	host: HTMLDivElement,
	props: TuiTerminalPanelProps,
	transaction: ReturnType<typeof createCleanupTransaction>,
	disposeTerminal: (terminal: Terminal) => void,
): () => void {
	const terminal = transaction.acquire(
		() => new Terminal({ convertEol: true, cursorBlink: false, fontSize: 15, scrollback: 500 }),
		disposeTerminal,
	);
	const fit = new FitAddon();
	terminal.loadAddon(fit);
	terminal.open(host);
	fit.fit();
	const engine = createMemoryInteractionEngine();
	const scope = transaction.acquire(
		() => engine.mount({ formType: "profile", placement: "browser-playground" }),
		(resource) => resource.dispose(),
	);
	scope.activate();
	const textInput = transaction.acquire(createBrowserTextInput, (resource) => resource.dispose());
	const output = createBrowserOutputStream((value) => terminal.write(value), terminal.cols, terminal.rows);
	const router = transaction.acquire(
		() => createSequenceRouter({ dispatch: scope.dispatch, emitText: textInput.emit }),
		(resource) => resource.dispose(),
	);
	let active = true;
	const publish = () => {
		if (!active) return;
		notifySafely(props.onMetrics, {
			columns: terminal.cols,
			rows: terminal.rows,
			output: renderedRows(host),
			textListeners: textInput.listenerCount(),
			active: true,
		});
	};
	const ink = transaction.acquire(
		() => render(createTuiView(props, scope, textInput, terminal.cols, publish), createInkBrowserOptions(output)),
		disposeInkInstance,
	);
	transaction.acquire(
		() => terminal.onData(router.push),
		(data) => data.dispose(),
	);
	transaction.add(acquirePasteListener(terminal, router));
	const resizeTerminal = (columns: number, rows: number) => {
		if (!active) return;
		terminal.resize(columns, rows);
		output.resize(columns, rows);
		ink.rerender(createTuiView(props, scope, textInput, columns, publish));
		publish();
	};
	const observer = transaction.acquire(
		() => new ResizeObserver(() => resizeTerminal(terminal.cols, terminal.rows)),
		(resource) => resource.disconnect(),
	);
	observer.observe(host);
	notifySafely(props.onController, { resize: resizeTerminal });
	publish();
	queueMicrotask(publish);
	return () => {
		if (!active) return;
		active = false;
		notifySafely(props.onController, undefined);
		const result = transaction.dispose();
		if (result.errors.length > 0) reportError(props, new AggregateError(result.errors, "Terminal cleanup failed"));
		notifySafely(props.onMetrics, { columns: 0, rows: 0, output: "", textListeners: 0, active: false });
	};
}

type Scope = ReturnType<ReturnType<typeof createMemoryInteractionEngine>["mount"]>;
type TextInput = ReturnType<typeof createBrowserTextInput>;

function createTuiView(
	props: TuiTerminalPanelProps,
	scope: Scope,
	textInput: TextInput,
	width: number,
	onSubmitSuccess: () => void,
) {
	return (
		<FormbarTui
			form={props.form}
			schema={props.schema}
			layout={props.schema.layout}
			capability={scope.capability}
			textInput={textInput}
			viewportWidth={width}
			onSubmitSuccess={onSubmitSuccess}
		/>
	);
}

function reportError(props: TuiTerminalPanelProps, error: unknown): void {
	if (props.onLifecycleError) notifySafely(props.onLifecycleError, error);
	else console.error("Terminal lifecycle failure", error);
}

function renderedRows(host: HTMLElement): string {
	return [...host.querySelectorAll<HTMLElement>('.xterm-rows > div, [role="listitem"]')]
		.map((row) => row.textContent ?? "")
		.filter(Boolean)
		.join("\n");
}

function acquirePasteListener(terminal: Terminal, router: ReturnType<typeof createSequenceRouter>): () => void {
	const paste = (event: ClipboardEvent) => {
		const text = event.clipboardData?.getData("text/plain");
		if (text === undefined) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		router.paste(text);
	};
	const key = (event: KeyboardEvent): boolean => {
		if (
			!event.isTrusted ||
			event.type !== "keydown" ||
			(!event.ctrlKey && !event.metaKey) ||
			event.key.toLowerCase() !== "v"
		)
			return true;
		event.preventDefault();
		void navigator.clipboard.readText().then(router.paste, () => undefined);
		return false;
	};
	terminal.attachCustomKeyEventHandler(key);
	try {
		document.addEventListener("paste", paste, true);
	} catch (error) {
		terminal.attachCustomKeyEventHandler(() => true);
		throw error;
	}
	return () => {
		terminal.attachCustomKeyEventHandler(() => true);
		document.removeEventListener("paste", paste, true);
	};
}
