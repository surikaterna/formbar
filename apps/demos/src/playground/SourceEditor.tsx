import { type KeyboardEvent, useRef } from "react";
import { type PlaygroundSources, SOURCE_KEYS, type SourceErrors, type SourceKey } from "./contracts";

const SOURCE_LABELS = {
	schema: "Schema",
	definition: "FormDefinition",
	initialData: "Initial Data",
} satisfies Record<SourceKey, string>;

const SOURCE_TABS = SOURCE_KEYS.map((key) => ({ key, label: SOURCE_LABELS[key] }));

interface SourceEditorProps {
	readonly active: SourceKey;
	readonly sources: PlaygroundSources;
	readonly baseline: PlaygroundSources;
	readonly errors: SourceErrors;
	readonly onActiveChange: (key: SourceKey) => void;
	readonly onChange: (value: string) => void;
	readonly onApply: () => void;
}

function nextTab(current: SourceKey, direction: number): SourceKey {
	const currentIndex = SOURCE_KEYS.indexOf(current);
	return SOURCE_KEYS[(currentIndex + direction + SOURCE_KEYS.length) % SOURCE_KEYS.length];
}

function useTabNavigation(active: SourceKey, onChange: (key: SourceKey) => void) {
	const refs = useRef<Partial<Record<SourceKey, HTMLButtonElement>>>({});
	const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
		event.preventDefault();
		const next = nextTab(active, event.key === "ArrowRight" ? 1 : -1);
		onChange(next);
		window.setTimeout(() => refs.current[next]?.focus(), 0);
	};
	return { refs, onKeyDown };
}

function SourceTabs(props: Pick<SourceEditorProps, "active" | "sources" | "baseline" | "errors" | "onActiveChange">) {
	const navigation = useTabNavigation(props.active, props.onActiveChange);
	return (
		<div role="tablist" aria-label="Document sources" className="flex flex-wrap border-b border-border">
			{SOURCE_TABS.map(({ key, label }) => (
				<button
					key={key}
					ref={(element) => {
						if (element) navigation.refs.current[key] = element;
					}}
					type="button"
					role="tab"
					id={`source-tab-${key}`}
					aria-selected={props.active === key}
					aria-controls={`source-panel-${key}`}
					tabIndex={props.active === key ? 0 : -1}
					onKeyDown={navigation.onKeyDown}
					onClick={() => props.onActiveChange(key)}
					className={`px-3 py-2 text-xs font-medium ${props.active === key ? "border-b-2 border-primary text-foreground" : "text-muted-foreground"}`}
				>
					{label} {props.sources[key] !== props.baseline[key] ? "●" : ""} {props.errors[key] ? "⚠" : ""}
				</button>
			))}
		</div>
	);
}

function SourcePanel(props: Pick<SourceEditorProps, "active" | "sources" | "errors" | "onChange" | "onApply">) {
	const error = props.errors[props.active];
	return (
		<>
			{SOURCE_KEYS.map((key) => {
				const isActive = props.active === key;
				return (
					<div
						key={key}
						id={`source-panel-${key}`}
						role="tabpanel"
						aria-labelledby={`source-tab-${key}`}
						hidden={!isActive}
						className="flex min-h-0 flex-1 flex-col p-3"
					>
						{isActive && (
							<>
								<label htmlFor={`source-${key}`} className="mb-2 text-xs font-semibold text-muted-foreground">
									{SOURCE_LABELS[key]} — strict JSON
								</label>
								<textarea
									id={`source-${key}`}
									value={props.sources[key]}
									onChange={(event) => props.onChange(event.target.value)}
									onKeyDown={(event) => {
										if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey)) return;
										event.preventDefault();
										props.onApply();
									}}
									spellCheck={false}
									aria-invalid={Boolean(error)}
									aria-describedby={error ? `source-error-${key}` : undefined}
									className="min-h-80 flex-1 resize-y rounded-md border border-input bg-surface-inset p-3 font-mono text-xs text-code-foreground outline-none focus:ring-2 focus:ring-ring"
								/>
								{error && (
									<p id={`source-error-${key}`} role="alert" tabIndex={-1} className="mt-2 text-xs text-destructive">
										{error}
									</p>
								)}
							</>
						)}
					</div>
				);
			})}
		</>
	);
}

export function SourceEditor(props: SourceEditorProps) {
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<SourceTabs {...props} />
			<SourcePanel {...props} />
		</div>
	);
}
