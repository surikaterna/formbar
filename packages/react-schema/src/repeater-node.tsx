import type { FormNode, ResolvedRepeaterState, RuntimeScopeInstance } from "@formbar/declarative";
import { fieldId } from "@formbar/react";
import { useEffect, useLayoutEffect, useReducer, useRef } from "react";
import type { ReactElement, RefObject } from "react";
import type { LayoutProps } from "./renderer-elements.js";
import { domIdToken } from "./renderer-evidence.js";
import type { RendererEnvironment } from "./renderer-types.js";
import { bindingKey } from "./repeater-coordinator.js";
import type { RepeaterIntentListener, StructuralIntent } from "./repeater-coordinator.js";
import { applyRowOperation, initialRowKeys } from "./repeater-keys.js";
import type { RowKeyState } from "./repeater-keys.js";

interface RepeaterProps {
	readonly node: Extract<FormNode, { type: "repeater" }>;
	readonly state: ResolvedRepeaterState;
	readonly environment: RendererEnvironment;
	readonly layout: LayoutProps;
	readonly renderChildren: (children: readonly FormNode[], scopes: readonly RuntimeScopeInstance[]) => ReactElement;
}

const useIsomorphicLayoutEffect = typeof document === "undefined" ? useEffect : useLayoutEffect;

export function RepeaterNodeView(props: RepeaterProps): ReactElement {
	const { node, state, environment } = props;
	const [, render] = useReducer((value) => value + 1, 0);
	const generation = useRef(0);
	const rows = useRef<RowKeyState>(initialRowKeys(state.instance.instanceKey, state.length));
	const rollback = useRef(new Map<symbol, RowKeyState>());
	const focus = useRef<StructuralIntent | undefined>(undefined);
	const announcement = useRef("");
	const rowElements = useRef(new Map<string, HTMLFieldSetElement>());
	const container = useRef<HTMLFieldSetElement>(null);
	reconcileRows(rows, rollback.current.size, state, generation);
	const listener = useRef<RepeaterIntentListener | undefined>(undefined);
	listener.current = intentListener(rows, rollback, focus, announcement, generation, render);
	useEffect(
		() =>
			environment.repeaters.register(
				bindingKey(state.binding ?? { namespace: "data", segments: [] }),
				listenerProxy(listener),
			),
		[environment.repeaters, state.binding],
	);
	useIsomorphicLayoutEffect(() =>
		restoreFocus(focus, rows.current, rowElements.current, container.current, environment.repeaters.appendTarget),
	);
	const legendId = fieldId(`${domIdToken(state.instance.instanceKey)}-legend`, environment.prefix);
	return (
		<RepeaterMarkup
			{...props}
			legendId={legendId}
			announcement={announcement.current}
			rowKeys={rows.current.keys}
			rowElements={rowElements.current}
			container={container}
		/>
	);
}

interface RepeaterMarkupProps extends RepeaterProps {
	readonly legendId: string;
	readonly announcement: string;
	readonly rowKeys: readonly string[];
	readonly rowElements: Map<string, HTMLFieldSetElement>;
	readonly container: RefObject<HTMLFieldSetElement | null>;
}

function RepeaterMarkup(props: RepeaterMarkupProps): ReactElement {
	const { node, state } = props;
	return (
		<fieldset
			ref={props.container}
			tabIndex={-1}
			aria-labelledby={props.legendId}
			data-formbar-node={node.id}
			{...props.layout.attributes}
			style={props.layout.style}
		>
			<legend id={props.legendId}>{state.label}</legend>
			<div aria-live="polite" data-formbar-repeater-status="">{`${state.length} items. ${props.announcement}`}</div>
			{state.status === "malformed" ? (
				<p data-formbar-diagnostic="malformed-repeater">Array value is unavailable.</p>
			) : null}
			{state.status === "ready" && state.length === 0 ? <p data-formbar-empty="">No items.</p> : null}
			{state.status === "ready" ? (
				<ol aria-label={`${state.label} items`}>
					{state.items.map((item) => {
						const key = props.rowKeys[item.index] as string;
						return (
							<li key={key}>
								<fieldset
									ref={(element) => setRowElement(props.rowElements, key, element)}
									aria-label={`Item ${item.index + 1}`}
									tabIndex={-1}
								>
									{props.renderChildren(node.children, item.scopes)}
								</fieldset>
							</li>
						);
					})}
				</ol>
			) : null}
		</fieldset>
	);
}

function reconcileRows(
	rows: { current: RowKeyState },
	pending: number,
	state: ResolvedRepeaterState,
	generation: { current: number },
): void {
	if (pending || rows.current.keys.length === state.length) return;
	generation.current += 1;
	rows.current = initialRowKeys(state.instance.instanceKey, state.length, generation.current);
}

function intentListener(
	rows: { current: RowKeyState },
	rollback: { current: Map<symbol, RowKeyState> },
	focus: { current: StructuralIntent | undefined },
	announcement: { current: string },
	generation: { current: number },
	render: () => void,
): RepeaterIntentListener {
	return {
		apply(intent) {
			rollback.current.set(intent.token, rows.current);
			rows.current = applyRowOperation(rows.current, intent.operation);
		},
		finish(intent, succeeded) {
			const previous = rollback.current.get(intent.token);
			rollback.current.delete(intent.token);
			if (!succeeded && previous) rows.current = previous;
			if (succeeded) {
				focus.current = intent;
				announcement.current = operationText(intent.operation.type);
			}
			render();
		},
		reset() {
			generation.current += 1;
			rows.current = initialRowKeys("reset", rows.current.keys.length, generation.current);
			rollback.current.clear();
			focus.current = undefined;
			announcement.current = "";
			render();
		},
	};
}

function operationText(operation: StructuralIntent["operation"]["type"]): string {
	if (operation === "append" || operation === "insert") return "Item added.";
	if (operation === "remove") return "Item removed.";
	return "Item moved.";
}

function listenerProxy(ref: { current: RepeaterIntentListener | undefined }): RepeaterIntentListener {
	return {
		apply: (intent) => ref.current?.apply(intent),
		finish: (intent, succeeded) => ref.current?.finish(intent, succeeded),
		reset: () => ref.current?.reset(),
	};
}

function setRowElement(map: Map<string, HTMLFieldSetElement>, key: string, element: HTMLFieldSetElement | null): void {
	if (element) map.set(key, element);
	else map.delete(key);
}

function restoreFocus(
	focus: { current: StructuralIntent | undefined },
	rows: RowKeyState,
	elements: ReadonlyMap<string, HTMLFieldSetElement>,
	container: HTMLFieldSetElement | null,
	appendTarget: (key: string) => HTMLButtonElement | undefined,
): void {
	const intent = focus.current;
	if (!intent) return;
	focus.current = undefined;
	const operation = intent.operation;
	const index =
		operation.type === "append"
			? rows.keys.length - 1
			: operation.type === "insert"
				? operation.index
				: operation.type === "remove"
					? Math.min(operation.index, rows.keys.length - 1)
					: operation.to;
	const row = elements.get(rows.keys[index] ?? "");
	const selector =
		operation.type === "move" || operation.type === "swap"
			? `[data-formbar-action-node="${intent.actionNodeId}"]`
			: "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)";
	const append = appendTarget(intent.key);
	const target = row?.querySelector<HTMLElement>(selector) ?? row ?? append ?? container;
	target?.focus();
}
