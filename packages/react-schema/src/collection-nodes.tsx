import type { AccordionNode, FormNode, TabsNode } from "@formbar/declarative";
import { fieldId } from "@formbar/react";
import { useRef, useState } from "react";
import type { KeyboardEvent, ReactElement } from "react";
import type { LayoutProps } from "./renderer-elements.js";
import { domIdToken } from "./renderer-evidence.js";
import type { RendererEnvironment } from "./renderer-types.js";

interface CollectionProps<T> {
	readonly node: T;
	readonly environment: RendererEnvironment;
	readonly renderChildren: (children: readonly FormNode[]) => ReactElement;
	readonly layout: LayoutProps;
}

export function TabsView({ node, environment, renderChildren, layout }: CollectionProps<TabsNode>): ReactElement {
	const [active, setActive] = useState(0);
	const buttons = useRef<(HTMLButtonElement | null)[]>([]);
	const selected = Math.min(active, Math.max(0, node.tabs.length - 1));
	const activate = (index: number) => {
		setActive(index);
		buttons.current[index]?.focus();
	};
	return (
		<div data-formbar-node={node.id} {...layout.attributes} style={layout.style}>
			<div role="tablist">
				{node.tabs.map((tab, index) => {
					const ids = tabIds(environment.prefix, node.id, tab.id);
					return (
						<button
							key={tab.id}
							ref={(element) => {
								buttons.current[index] = element;
							}}
							id={ids.tab}
							type="button"
							role="tab"
							aria-selected={selected === index}
							aria-controls={ids.panel}
							tabIndex={selected === index ? 0 : -1}
							onClick={() => setActive(index)}
							onKeyDown={(event) => tabKey(event, index, node.tabs.length, activate)}
						>
							{tab.label}
						</button>
					);
				})}
			</div>
			{node.tabs[selected] ? (
				<div
					id={tabIds(environment.prefix, node.id, node.tabs[selected].id).panel}
					role="tabpanel"
					aria-labelledby={tabIds(environment.prefix, node.id, node.tabs[selected].id).tab}
				>
					{renderChildren(node.tabs[selected].children)}
				</div>
			) : null}
		</div>
	);
}

export function AccordionView({
	node,
	environment,
	renderChildren,
	layout,
}: CollectionProps<AccordionNode>): ReactElement {
	const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set(node.items.length ? [0] : []));
	const buttons = useRef<(HTMLButtonElement | null)[]>([]);
	const toggle = (index: number) =>
		setExpanded((current) => {
			const next = new Set(current);
			next.has(index) ? next.delete(index) : next.add(index);
			return next;
		});
	return (
		<div data-formbar-node={node.id} {...layout.attributes} style={layout.style}>
			{node.items.map((item, index) => {
				const ids = accordionIds(environment.prefix, node.id, item.id);
				return (
					<div key={item.id}>
						<h3>
							<button
								ref={(element) => {
									buttons.current[index] = element;
								}}
								id={ids.button}
								type="button"
								aria-expanded={expanded.has(index)}
								aria-controls={ids.panel}
								onClick={() => toggle(index)}
								onKeyDown={(event) => accordionKey(event, index, node.items.length, buttons.current)}
							>
								{item.label}
							</button>
						</h3>
						{expanded.has(index) ? (
							// biome-ignore lint/a11y/useSemanticElements: The frozen public contract requires explicit labelled regions.
							<div id={ids.panel} role="region" aria-labelledby={ids.button}>
								{renderChildren(item.children)}
							</div>
						) : null}
					</div>
				);
			})}
		</div>
	);
}

function tabKey(event: KeyboardEvent, index: number, count: number, activate: (index: number) => void): void {
	let next: number | undefined;
	if (event.key === "ArrowRight") next = (index + 1) % count;
	if (event.key === "ArrowLeft") next = (index - 1 + count) % count;
	if (event.key === "Home") next = 0;
	if (event.key === "End") next = count - 1;
	if (next === undefined || count === 0) return;
	event.preventDefault();
	activate(next);
}

function accordionKey(
	event: KeyboardEvent,
	index: number,
	count: number,
	buttons: readonly (HTMLButtonElement | null)[],
): void {
	let next: number | undefined;
	if (event.key === "ArrowDown") next = (index + 1) % count;
	if (event.key === "ArrowUp") next = (index - 1 + count) % count;
	if (event.key === "Home") next = 0;
	if (event.key === "End") next = count - 1;
	if (next === undefined || count === 0) return;
	event.preventDefault();
	buttons[next]?.focus();
}

function tabIds(prefix: string, nodeId: string, itemId: string) {
	const token = domIdToken(`${nodeId}:${itemId}`);
	return { tab: fieldId(`${token}-tab`, prefix), panel: fieldId(`${token}-tabpanel`, prefix) };
}

function accordionIds(prefix: string, nodeId: string, itemId: string) {
	const token = domIdToken(`${nodeId}:${itemId}`);
	return { button: fieldId(`${token}-button`, prefix), panel: fieldId(`${token}-region`, prefix) };
}
