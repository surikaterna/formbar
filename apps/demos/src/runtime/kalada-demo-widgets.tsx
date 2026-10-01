import type { KaladaControlProps } from "@formbar/react-schema";
import type { ReactNode } from "react";
import { FieldGrid, InspectionPanel } from "../extensions/custom-layout-profile";
import { widgetAccessibility } from "./kalada-demo-widget-accessibility";

type Widget = (props: KaladaControlProps) => ReactNode;
type Option = { value: string | number | boolean | null; title?: string; disabled?: boolean };
const optionKey = (entry: Option) => `${typeof entry.value}:${String(entry.value)}`;

function options(props: KaladaControlProps): Option[] {
	const raw = props.props.richOptions ?? props.props.options;
	return Array.isArray(raw)
		? raw.filter(
				(entry): entry is Option => !!entry && typeof entry === "object" && !Array.isArray(entry) && "value" in entry,
			)
		: [];
}

function write(props: KaladaControlProps, value: unknown) {
	if (props.disabled || props.readOnly) return;
	const outcome = props.writers.value?.(value);
	if (outcome?.status !== "applied" && outcome?.status !== "queued")
		throw new Error(`Widget write: ${outcome?.status ?? "missing"}`);
}

function Rating(props: KaladaControlProps) {
	return (
		<fieldset className="m-0 min-w-0 border-0 p-0" data-widget="demo16.rating" {...widgetAccessibility(props)}>
			{[1, 2, 3, 4, 5].map((rating) => (
				<button
					key={rating}
					type="button"
					aria-label={`${props.nodeId}: ${rating}`}
					aria-pressed={props.value === rating}
					disabled={props.disabled || props.readOnly}
					onClick={() => write(props, rating)}
				>
					{props.props.icon === "heart" ? "♥" : "★"}
				</button>
			))}
		</fieldset>
	);
}

function Choices(props: KaladaControlProps & { kind: string }) {
	const entries = options(props);
	if (props.kind === "demo16.checkbox-group") {
		const selected = Array.isArray(props.value) ? props.value : [];
		return (
			<fieldset className="m-0 min-w-0 border-0 p-0" data-widget={props.kind} {...widgetAccessibility(props)}>
				{entries.map((entry) => (
					<label key={optionKey(entry)}>
						<input
							type="checkbox"
							checked={selected.includes(entry.value)}
							disabled={props.disabled || props.readOnly || entry.disabled}
							onChange={() =>
								write(
									props,
									selected.includes(entry.value)
										? selected.filter((item) => item !== entry.value)
										: [...selected, entry.value],
								)
							}
						/>
						{entry.title ?? String(entry.value)}
					</label>
				))}
			</fieldset>
		);
	}
	return (
		<fieldset className="m-0 min-w-0 border-0 p-0" data-widget={props.kind} {...widgetAccessibility(props)}>
			{entries.map((entry) => (
				<button
					key={optionKey(entry)}
					type="button"
					aria-label={`${props.props.label ?? props.nodeId}: ${entry.title ?? entry.value}`}
					aria-pressed={props.value === entry.value}
					disabled={props.disabled || props.readOnly || entry.disabled}
					onClick={() => write(props, entry.value)}
				>
					{entry.title ?? String(entry.value)}
				</button>
			))}
		</fieldset>
	);
}

function Select(props: KaladaControlProps) {
	const entries = options(props);
	return (
		<select
			{...widgetAccessibility(props)}
			required={props.required}
			data-widget="demo16.rich-select"
			aria-label={props.nodeId}
			value={entries.findIndex((entry) => Object.is(entry.value, props.value))}
			disabled={props.disabled || props.readOnly}
			onChange={(event) => {
				const entry = entries[Number(event.currentTarget.value)];
				if (entry && !entry.disabled) write(props, entry.value);
			}}
		>
			<option value={-1} disabled>
				Choose
			</option>
			{entries.map((entry, index) => (
				<option key={optionKey(entry)} value={index} disabled={entry.disabled}>
					{entry.title ?? String(entry.value)}
				</option>
			))}
		</select>
	);
}

function Range(props: KaladaControlProps & { kind: string }) {
	return (
		<div data-widget={props.kind}>
			{props.kind === "demo16.progress" ? <progress value={Number(props.value ?? 0)} max={100} /> : null}
			<input
				{...widgetAccessibility(props)}
				required={props.required}
				type="range"
				aria-label={props.nodeId}
				value={Number(props.value ?? 0)}
				disabled={props.disabled || props.readOnly}
				onChange={(event) => write(props, event.currentTarget.valueAsNumber)}
			/>
			<output>{String(props.value ?? 0)}</output>
		</div>
	);
}

function NumericPresentation(props: KaladaControlProps) {
	const id = props.a11y?.controlId ?? `demo19-${props.nodeId}`;
	return (
		<>
			{props.a11y ? null : <label htmlFor={id}>Unit Price ($)</label>}
			<input
				{...widgetAccessibility(props)}
				required={props.required}
				id={id}
				type="number"
				value={typeof props.value === "number" ? props.value : ""}
				min={typeof props.props.min === "number" ? props.props.min : undefined}
				step={typeof props.props.step === "number" ? props.props.step : "any"}
				disabled={props.disabled}
				readOnly={props.readOnly}
				onChange={(event) => {
					const input = event.currentTarget;
					write(props, input.value === "" ? null : input.valueAsNumber);
				}}
			/>
		</>
	);
}

export const kaladaDemoWidgets: Readonly<Record<string, Widget>> = {
	"demo19.numeric-presentation": NumericPresentation,
	"demo16.rating": Rating,
	"demo16.color": (props) => <Choices {...props} kind="demo16.color" />,
	"demo16.checkbox-group": (props) => <Choices {...props} kind="demo16.checkbox-group" />,
	"demo16.rich-options": (props) => <Choices {...props} kind="demo16.rich-options" />,
	"demo16.rich-select": Select,
	"demo16.range": (props) => <Range {...props} kind="demo16.range" />,
	"demo16.progress": (props) => <Range {...props} kind="demo16.progress" />,
};

export const kaladaDemoRenderers: Readonly<Record<string, Widget>> = {
	"demo17.inspection-panel": (props) => (
		<InspectionPanel
			nodeId={props.nodeId}
			instanceKey={props.nodeId}
			renderer="demo17.inspection-panel"
			props={props.props}
			policy={{ visible: true, disabled: props.disabled, readOnly: props.readOnly }}
		>
			{props.children}
		</InspectionPanel>
	),
	"demo17.field-grid": (props) => (
		<FieldGrid
			nodeId={props.nodeId}
			instanceKey={props.nodeId}
			renderer="demo17.field-grid"
			props={props.props}
			policy={{ visible: true, disabled: props.disabled, readOnly: props.readOnly }}
		>
			{props.children}
		</FieldGrid>
	),
};
