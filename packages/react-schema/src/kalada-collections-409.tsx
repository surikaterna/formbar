import { useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactElement, ReactNode } from "react";
import { kaladaDomId409, kaladaLayoutProps409 } from "./kalada-layout-409.js";
import type { KaladaLayout409 } from "./kalada-layout-409.js";
import type { RepeaterFocus } from "./kalada-repeater-focus.js";

export interface KaladaCollectionItem409 {
	readonly id: string;
	readonly label: string;
	/** Host-only rendering callback. Never supplied by a serialized definition. */
	readonly renderChildren: () => ReactNode;
}
interface CollectionProps409 {
	readonly nodeId: string;
	readonly instanceKey: string;
	readonly prefix: string;
	readonly items: readonly KaladaCollectionItem409[];
	readonly presentation?: KaladaLayout409;
}

function collectionIds(props: CollectionProps409, item: KaladaCollectionItem409, kind: string) {
	const token = `${props.instanceKey}:${item.id}`;
	return {
		button: kaladaDomId409(props.prefix, token, kind === "tab" ? "tab" : "button"),
		panel: kaladaDomId409(props.prefix, token, kind === "tab" ? "tabpanel" : "region"),
	};
}

function nextIndex(event: KeyboardEvent, index: number, count: number, vertical: boolean): number | undefined {
	if (!count) return undefined;
	if (event.key === (vertical ? "ArrowDown" : "ArrowRight")) return (index + 1) % count;
	if (event.key === (vertical ? "ArrowUp" : "ArrowLeft")) return (index - 1 + count) % count;
	if (event.key === "Home") return 0;
	if (event.key === "End") return count - 1;
	return undefined;
}

export function KaladaTabs409(props: CollectionProps409): ReactElement {
	const [active, setActive] = useState(0);
	const buttons = useRef<(HTMLButtonElement | null)[]>([]);
	const selected = Math.min(active, Math.max(0, props.items.length - 1));
	const layout = kaladaLayoutProps409(props.presentation);
	const keyDown = (event: KeyboardEvent, index: number) => {
		const next = nextIndex(event, index, props.items.length, false);
		if (next === undefined) return;
		event.preventDefault();
		setActive(next);
		buttons.current[next]?.focus();
	};
	return (
		<div data-formbar-node={props.nodeId} {...layout.attributes} style={layout.style}>
			<div role="tablist">
				{props.items.map((item, index) => {
					const ids = collectionIds(props, item, "tab");
					return (
						<button
							key={item.id}
							ref={(element) => {
								buttons.current[index] = element;
							}}
							id={ids.button}
							type="button"
							role="tab"
							aria-selected={selected === index}
							aria-controls={ids.panel}
							tabIndex={selected === index ? 0 : -1}
							onClick={() => setActive(index)}
							onKeyDown={(event) => keyDown(event, index)}
						>
							{item.label}
						</button>
					);
				})}
			</div>
			{props.items.map((item, index) => {
				const ids = collectionIds(props, item, "tab");
				return (
					<div key={item.id} id={ids.panel} role="tabpanel" aria-labelledby={ids.button} hidden={selected !== index}>
						{selected === index ? item.renderChildren() : null}
					</div>
				);
			})}
		</div>
	);
}

function toggleExpanded(current: ReadonlySet<string>, id: string) {
	const next = new Set(current);
	if (next.has(id)) next.delete(id);
	else next.add(id);
	return next;
}

export function KaladaAccordion409(props: CollectionProps409): ReactElement {
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(
		() => new Set(props.items.length ? [props.items[0].id] : []),
	);
	const buttons = useRef<(HTMLButtonElement | null)[]>([]);
	const layout = kaladaLayoutProps409(props.presentation);
	const toggle = (id: string) => setExpanded((current) => toggleExpanded(current, id));
	const keyDown = (event: KeyboardEvent, index: number) => {
		const next = nextIndex(event, index, props.items.length, true);
		if (next === undefined) return;
		event.preventDefault();
		buttons.current[next]?.focus();
	};
	return (
		<div data-formbar-node={props.nodeId} {...layout.attributes} style={layout.style}>
			{props.items.map((item, index) => {
				const ids = collectionIds(props, item, "accordion");
				return (
					<div key={item.id}>
						<h3>
							<button
								ref={(element) => {
									buttons.current[index] = element;
								}}
								id={ids.button}
								type="button"
								aria-expanded={expanded.has(item.id)}
								aria-controls={ids.panel}
								onClick={() => toggle(item.id)}
								onKeyDown={(event) => keyDown(event, index)}
							>
								{item.label}
							</button>
						</h3>
						{/* biome-ignore lint/a11y/useSemanticElements: Public V1 contract requires labelled regions. */}
						<div id={ids.panel} role="region" aria-labelledby={ids.button} hidden={!expanded.has(item.id)}>
							{expanded.has(item.id) ? item.renderChildren() : null}
						</div>
					</div>
				);
			})}
		</div>
	);
}

/** Rows are keyed by host identity, not location; no token here grants write authority. */
export function KaladaRepeaterRows409(props: {
	readonly nodeId: string;
	readonly label: string;
	readonly rows: readonly { readonly key: string; readonly renderChildren: () => ReactNode }[];
	readonly presentation?: KaladaLayout409;
	readonly focus?: RepeaterFocus;
	readonly scopeKey?: string;
}): ReactElement {
	const layout = kaladaLayoutProps409(props.presentation);
	useLayoutEffect(() => {
		if (props.scopeKey)
			props.focus?.order(
				props.scopeKey,
				props.rows.map((row) => row.key),
			);
	}, [props.focus, props.scopeKey, props.rows]);
	return (
		<fieldset
			ref={(element) => {
				if (props.scopeKey) props.focus?.container(props.scopeKey, element);
			}}
			tabIndex={-1}
			data-formbar-node={props.nodeId}
			{...layout.attributes}
			style={layout.style}
		>
			<legend>{props.label}</legend>
			{props.rows.length === 0 ? <p data-formbar-empty="">No items.</p> : null}
			<ol aria-label={`${props.label} items`}>
				{props.rows.map((row, index) => (
					<li key={row.key} data-kalada-row-key={row.key}>
						<fieldset
							ref={(element) => {
								if (props.scopeKey) props.focus?.rowElement(props.scopeKey, row.key, element);
							}}
							tabIndex={-1}
							aria-label={`Item ${index + 1}`}
						>
							{row.renderChildren()}
						</fieldset>
					</li>
				))}
			</ol>
		</fieldset>
	);
}

/** Unregistered renderers never receive writers, children, or an executable callback. */
export function KaladaUnknownRenderer409(props: {
	readonly nodeId: string;
	readonly rendererId: string;
}): ReactElement {
	return (
		// biome-ignore lint/a11y/useSemanticElements: Diagnostic status matches public V1 fallback semantics.
		<div
			role="status"
			data-formbar-diagnostic="missing-extension"
			data-formbar-node={props.nodeId}
			data-formbar-extension={props.rendererId}
		>
			This form item cannot be rendered.
		</div>
	);
}
