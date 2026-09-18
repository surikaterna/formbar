import { type Instance as InkInstance, render } from "ink";
import { createElement } from "react";
import { StandaloneApp } from "./standalone-app.js";
import { createStandaloneInteraction } from "./standalone-interaction.js";
import type {
	StandaloneExitResult,
	StandaloneInstance,
	StandaloneOptions,
	StandaloneSignal,
} from "./standalone-types.js";

const leasedInputs = new WeakSet<object>();
const leasedOutputs = new WeakSet<object>();

interface RuntimeState {
	result?: StandaloneExitResult;
	ink?: InkInstance;
	finished: boolean;
	resolve: (result: StandaloneExitResult) => void;
	reject: (error: unknown) => void;
}

export function renderStandaloneForm<TData, TUi>(options: StandaloneOptions<TData, TUi>): StandaloneInstance {
	const streams = resolveStreams(options);
	assertStartup(options, streams.stdin, streams.stdout);
	acquireLease(streams.stdin, streams.stdout);
	const interaction = createStandaloneInteraction();
	const cleanups: (() => void)[] = [];
	let resolve!: RuntimeState["resolve"];
	let reject!: RuntimeState["reject"];
	const exited = new Promise<StandaloneExitResult>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	const state: RuntimeState = { finished: false, resolve, reject };
	if (options.formOwnership === "host") cleanups.push(() => options.form.dispose());
	cleanups.push(() => releaseLease(streams.stdin, streams.stdout));
	try {
		cleanups.push(installRawMode(streams.stdin));
		cleanups.push(() => interaction.dispose());
		installSignals(options.signals ?? [], cleanups, (signal) => {
			const result = state.result ?? { reason: "signal", signal };
			requestExit(state, result);
			finish(state, cleanups, result);
		});
		state.ink = render(
			createElement(StandaloneApp<TData, TUi>, {
				options,
				interaction,
				requestExit: (reason) => requestExit(state, { reason }),
			}),
			{ stdin: streams.stdin, stdout: streams.stdout, stderr: streams.stderr, exitOnCtrlC: false, patchConsole: false },
		);
		cleanups.push(() => state.ink?.unmount());
		void state.ink.waitUntilExit().then(
			() => finish(state, cleanups, state.result ?? { reason: "unmount" }),
			(error) => finish(state, cleanups, state.result ?? { reason: "unmount" }, error),
		);
	} catch (error) {
		throw cleanupError(error, cleanups, options.formOwnership === "host");
	}
	return {
		waitUntilExit: () => exited,
		unmount: () => {
			if (state.finished || state.result) return;
			const result = { reason: "unmount" } as const;
			requestExit(state, result);
			finish(state, cleanups, result);
		},
	};
}

function resolveStreams<TData, TUi>(options: StandaloneOptions<TData, TUi>) {
	return {
		stdin: options.stdin ?? process.stdin,
		stdout: options.stdout ?? process.stdout,
		stderr: options.stderr ?? process.stderr,
	};
}

function assertStartup<TData, TUi>(
	options: StandaloneOptions<TData, TUi>,
	stdin: NodeJS.ReadStream,
	stdout: NodeJS.WriteStream,
): void {
	if (!options.schema?.layout) throw new Error("Standalone Formbar requires a prepared schema with a layout");
	if (options.form.isDisposed()) throw new Error("Cannot render a disposed form");
	if (stdin.isTTY !== true || stdout.isTTY !== true || typeof stdin.setRawMode !== "function")
		throw new Error("Standalone Formbar requires interactive TTY stdin/stdout with raw-mode support");
	if (leasedInputs.has(stdin) || leasedOutputs.has(stdout))
		throw new Error("Standalone stdin/stdout stream is already leased");
}

function acquireLease(stdin: NodeJS.ReadStream, stdout: NodeJS.WriteStream): void {
	leasedInputs.add(stdin);
	leasedOutputs.add(stdout);
}
function releaseLease(stdin: NodeJS.ReadStream, stdout: NodeJS.WriteStream): void {
	leasedInputs.delete(stdin);
	leasedOutputs.delete(stdout);
}

function installRawMode(stdin: NodeJS.ReadStream): () => void {
	const original = stdin.setRawMode;
	const previous = stdin.isRaw === true;
	let current = previous;
	const guarded = (enabled: boolean): NodeJS.ReadStream => {
		if (!enabled && previous) return stdin;
		if (current === enabled) return stdin;
		original.call(stdin, enabled);
		current = enabled;
		return stdin;
	};
	stdin.setRawMode = guarded;
	try {
		guarded(true);
	} catch (error) {
		stdin.setRawMode = original;
		throw error;
	}
	return () => {
		try {
			guarded(previous);
		} finally {
			stdin.setRawMode = original;
		}
	};
}

function requestExit(state: RuntimeState, result: StandaloneExitResult): void {
	if (state.result) return;
	state.result = result;
}

function installSignals(
	signals: readonly StandaloneSignal[],
	cleanups: (() => void)[],
	exit: (signal: StandaloneSignal) => void,
): void {
	const unique = new Set(signals);
	for (const signal of unique) {
		const listener = () => exit(signal);
		process.on(signal, listener);
		cleanups.push(() => process.off(signal, listener));
	}
}

function finish(
	state: RuntimeState,
	cleanups: readonly (() => void)[],
	result: StandaloneExitResult,
	primary?: unknown,
): void {
	if (state.finished) return;
	state.finished = true;
	const error = cleanupError(primary, cleanups, false);
	if (error !== undefined) state.reject(error);
	else state.resolve(result);
}

function cleanupError(primary: unknown, cleanups: readonly (() => void)[], skipFirst: boolean): unknown {
	const errors: unknown[] = primary === undefined ? [] : [primary];
	for (let index = cleanups.length - 1; index >= (skipFirst ? 1 : 0); index -= 1) {
		try {
			cleanups[index]?.();
		} catch (error) {
			errors.push(error);
		}
	}
	if (errors.length === 0) return undefined;
	if (errors.length === 1) return errors[0];
	return new AggregateError(errors, "Standalone Formbar failed while cleaning up", { cause: primary });
}
