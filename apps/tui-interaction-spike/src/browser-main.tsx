import type { FormApi } from "@formbar/core";
import { StrictMode, Suspense, lazy, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { DemoFormView } from "../../demos/src/renderers/DemoFormRoot";
import "../../demos/src/globals.css";
import "./browser.css";
import { TerminalErrorBoundary } from "./TerminalErrorBoundary.js";
import type { TerminalController, TerminalMetrics } from "./TuiTerminalPanel.js";
import type { SpikeApi, SpikeSnapshot } from "./browser-types.js";
import { createFixtureForm, fixtureSchema } from "./fixture.js";

type PlaygroundMode = "web" | "tui" | "both";
type PlaygroundForm = FormApi<Record<string, unknown>, unknown>;

const TuiTerminalPanel = lazy(() => import("./TuiTerminalPanel.js"));
const initialTerminal: TerminalMetrics = { columns: 0, rows: 0, output: "", textListeners: 0, active: false };
const monitor = {
	form: undefined as PlaygroundForm | undefined,
	formIdentity: 0,
	mode: "web" as PlaygroundMode,
	terminal: initialTerminal,
	controller: undefined as TerminalController | undefined,
	submissions: 0,
	forms: { acquired: 0, disposed: 0, active: 0 },
	terminals: { acquired: 0, disposed: 0, active: 0 },
};

function PlaygroundRuntimeBoundary() {
	const [form, setForm] = useState<PlaygroundForm>();
	useEffect(() => {
		const owned = createFixtureForm(() => {
			monitor.submissions += 1;
		});
		monitor.form = owned;
		monitor.formIdentity += 1;
		monitor.forms.acquired += 1;
		monitor.forms.active += 1;
		setForm(owned);
		return () => {
			owned.dispose();
			monitor.forms.disposed += 1;
			monitor.forms.active -= 1;
			if (monitor.form === owned) monitor.form = undefined;
		};
	}, []);
	return form ? <Playground form={form} /> : <output>Preparing shared form…</output>;
}

function Playground({ form }: { readonly form: PlaygroundForm }) {
	const [mode, setMode] = useState<PlaygroundMode>("web");
	const [resetVersion, setResetVersion] = useState(0);
	const [message, setMessage] = useState("Ready");
	useEffect(() => {
		monitor.mode = mode;
	}, [mode]);
	const onMetrics = useCallback(updateTerminalMetrics, []);
	const onController = useCallback((controller: TerminalController | undefined) => {
		monitor.controller = controller;
	}, []);
	const submit = async () => {
		const result = await form.submit();
		setMessage(result.ok ? "Submitted shared form" : "Fix validation errors before submitting");
	};
	const reset = () => {
		form.reset();
		setResetVersion((version) => version + 1);
		setMessage("Reset shared form and renderer drafts");
	};
	return (
		<main>
			<header>
				<h1>Formbar Web + TUI playground</h1>
				<p>Two renderers, one caller-owned form and one prepared schema.</p>
			</header>
			<PlaygroundToolbar
				key={resetVersion}
				form={form}
				mode={mode}
				message={message}
				onMode={setMode}
				onSubmit={submit}
				onReset={reset}
			/>
			<RendererPanels
				form={form}
				mode={mode}
				resetVersion={resetVersion}
				onMetrics={onMetrics}
				onController={onController}
				onMode={setMode}
			/>
		</main>
	);
}

function updateTerminalMetrics(next: TerminalMetrics): void {
	if (next.active && !monitor.terminal.active) {
		monitor.terminals.acquired += 1;
		monitor.terminals.active += 1;
	}
	if (!next.active && monitor.terminal.active) {
		monitor.terminals.disposed += 1;
		monitor.terminals.active -= 1;
	}
	monitor.terminal = next;
}

interface ToolbarProps {
	readonly form: PlaygroundForm;
	readonly mode: PlaygroundMode;
	readonly message: string;
	readonly onMode: (mode: PlaygroundMode) => void;
	readonly onSubmit: () => Promise<void>;
	readonly onReset: () => void;
}

function PlaygroundToolbar({ form, mode, message, onMode, onSubmit, onReset }: ToolbarProps) {
	const state = useSyncExternalStore(form.subscribe, form.getState, form.getState);
	return (
		<div className="toolbar">
			<fieldset aria-label="Renderer" className="mode-selector">
				<legend>Renderer</legend>
				{(["web", "tui", "both"] as const).map((value) => (
					<button key={value} type="button" aria-pressed={mode === value} onClick={() => onMode(value)}>
						{value === "tui" ? "TUI" : `${value[0]?.toUpperCase()}${value.slice(1)}`}
					</button>
				))}
			</fieldset>
			<div className="shared-actions">
				<button type="button" onClick={() => void onSubmit()} disabled={state.meta.submission?.status === "running"}>
					Submit
				</button>
				<button type="button" onClick={onReset}>
					Reset
				</button>
			</div>
			<output aria-live="polite">{message}</output>
		</div>
	);
}

interface RendererPanelsProps {
	readonly form: PlaygroundForm;
	readonly mode: PlaygroundMode;
	readonly resetVersion: number;
	readonly onMetrics: (metrics: TerminalMetrics) => void;
	readonly onController: (controller: TerminalController | undefined) => void;
	readonly onMode: (mode: PlaygroundMode) => void;
}

function RendererPanels({ form, mode, resetVersion, onMetrics, onController, onMode }: RendererPanelsProps) {
	return (
		<div className={`renderer-grid mode-${mode}`}>
			{mode !== "tui" && (
				<section aria-labelledby="web-heading" className="renderer-panel" key={`web-${resetVersion}`}>
					<h2 id="web-heading">Web renderer</h2>
					<DemoFormView form={form} schema={fixtureSchema} />
				</section>
			)}
			{mode !== "web" && (
				<section aria-labelledby="tui-heading" className="renderer-panel terminal-panel">
					<h2 id="tui-heading">Terminal renderer</h2>
					<TerminalErrorBoundary key={resetVersion} onSwitchToWeb={() => onMode("web")}>
						<Suspense fallback={<output>Loading terminal renderer…</output>}>
							<TuiTerminalPanel form={form} schema={fixtureSchema} onMetrics={onMetrics} onController={onController} />
						</Suspense>
					</TerminalErrorBoundary>
				</section>
			)}
		</div>
	);
}

function snapshot(): SpikeSnapshot {
	const output = [...document.querySelectorAll<HTMLElement>('.terminal .xterm-rows > div, .terminal [role="listitem"]')]
		.map((row) => row.textContent ?? "")
		.filter(Boolean)
		.join("\n");
	return {
		mounted: monitor.forms.active === 1,
		mode: monitor.mode,
		formIdentity: monitor.formIdentity,
		columns: monitor.terminal.columns,
		rows: monitor.terminal.rows,
		finalState: { ...(monitor.form?.getState().data ?? {}) },
		submissions: monitor.submissions,
		textListeners: monitor.terminal.textListeners,
		resources: { forms: { ...monitor.forms }, terminals: { ...monitor.terminals } },
		output,
		layoutSignature: output,
		yogaOutput: output.includes("Name") && output.includes("Actions:"),
	};
}

const api: SpikeApi = {
	snapshot,
	resize: (columns, rows) => monitor.controller?.resize(columns, rows),
	setMode: (mode) =>
		document
			.querySelector<HTMLButtonElement>(
				`button[aria-pressed][type="button"]:nth-of-type(${mode === "web" ? 1 : mode === "tui" ? 2 : 3})`,
			)
			?.click(),
	setValue: (path, value) => monitor.form?.fieldDynamic(path).set(value),
};
window.__formbarTuiSpike = api;

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
createRoot(root).render(
	<StrictMode>
		<PlaygroundRuntimeBoundary />
	</StrictMode>,
);
