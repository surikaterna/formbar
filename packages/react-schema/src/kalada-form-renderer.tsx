import type { KaladaV1Host } from "@formbar/declarative";
import type { ComponentType, FormEvent, ReactElement, ReactNode } from "react";
import { Fragment, useId, useMemo, useRef, useState } from "react";
import { KaladaAccordion409, KaladaRepeaterRows409, KaladaTabs409 } from "./kalada-collections-409.js";
import { CommitLeases, KaladaFormContext, type LeasedWriter } from "./kalada-commit-lease.js";
import { KaladaCustomControl } from "./kalada-custom-control.js";
import { useKaladaHostObservation } from "./kalada-host-observation.js";
import { KaladaIssueSummary, useDeniedFocus } from "./kalada-issue-summary.js";
import { KaladaGroup409, KaladaOutput409, KaladaSection409, kaladaLayoutProps409 } from "./kalada-layout-409.js";
import { nativeControl } from "./kalada-native-controls.js";
import { KaladaNativeField } from "./kalada-native-field.js";
import { associateRepeaters } from "./kalada-repeater-associations.js";
import { type RepeaterFocus, useRepeaterFocus } from "./kalada-repeater-focus.js";
import { KaladaValidationFeedback, validationDescriptions } from "./kalada-validation-markup.js";
import { indexKaladaView } from "./kalada-view-index.js";

type View = ReturnType<KaladaV1Host["snapshot"]>;
type Control = View["controls"][number];
type Node = View["tree"];
type RenderProps = KaladaFormRendererProps & {
	readonly feedback: ReadonlyMap<string, readonly string[]>;
	readonly prefix: string;
	readonly index: ReturnType<typeof indexKaladaView>;
	readonly focus: RepeaterFocus;
	readonly associations: ReturnType<typeof associateRepeaters>;
	readonly row?: { scope: string; key: string };
};
export interface KaladaControlProps {
	readonly nodeId: string;
	readonly children?: ReactNode;
	readonly value?: Control["value"];
	readonly props: Control["props"];
	readonly writers: Readonly<Record<string, LeasedWriter>>;
	readonly disabled: boolean;
	readonly readOnly: boolean;
	readonly label?: string | undefined;
	readonly description?: string | undefined;
	readonly required?: boolean;
	readonly dirty?: boolean;
	readonly touched?: boolean;
	readonly valid?: boolean;
	readonly validating?: boolean;
	readonly onBlur?: Control["onBlur"];
	readonly a11y?: {
		readonly controlId: string;
		readonly labelId: string;
		readonly descriptionId?: string | undefined;
		readonly issueId?: string | undefined;
		readonly describedBy?: string | undefined;
		readonly invalid: boolean;
	};
}
export interface KaladaFormRendererProps {
	readonly host: KaladaV1Host;
	/** Trusted host-installed components, never definition-supplied functions. */
	readonly renderers?: Readonly<Record<string, ComponentType<KaladaControlProps>>>;
	readonly widgets?: Readonly<Record<string, ComponentType<KaladaControlProps>>>;
}

const nativeWidgets = new Set([
	"text",
	"number",
	"checkbox",
	"textarea",
	"select",
	"radio",
	"date",
	"time",
	"email",
	"url",
	"tel",
	"password",
	"search",
]);

function show(control: Control, props: RenderProps, label?: string, children?: ReactNode): ReactElement {
	const custom =
		control.type === "custom" ? props.renderers?.[control.rendererId] : props.widgets?.[control.rendererId];
	if (custom)
		return (
			<KaladaCustomControl
				key={control.key}
				control={control}
				component={custom}
				feedbackIds={props.feedback.get(control.key)}
				host={props.host}
				{...(label === undefined ? {} : { label })}
			>
				{children}
			</KaladaCustomControl>
		);
	if (control.type === "custom") throw new TypeError(`${control.path}.renderer: MISSING_RENDERER`);
	if (!nativeWidgets.has(control.rendererId)) throw new TypeError(`${control.path}.widget: MISSING_RENDERER`);
	return (
		<KaladaNativeField
			key={control.key}
			control={control}
			prefix={props.prefix}
			feedbackIds={props.feedback.get(control.key)}
			focusRef={(element) => {
				if (props.row) props.focus.control(props.row.scope, props.row.key, control.key, element);
			}}
			{...(label === undefined ? {} : { label })}
		/>
	);
}

function ActionDestination({
	node,
	view,
	value,
	change,
}: {
	node: Node;
	view: View;
	value: string;
	change: (value: string) => void;
}): ReactElement {
	return (
		<select aria-label={`${node.nodeId} destination`} value={value} onChange={(event) => change(event.target.value)}>
			<option value="">Choose row</option>
			{view.rows.map((row) => (
				<option key={row.key} value={row.key}>
					{row.key}
				</option>
			))}
		</select>
	);
}

function ActionButton({ node, view, props }: { node: Node; view: View; props: RenderProps }): ReactElement {
	if (!node.action) throw new TypeError(`${node.path}.action: MISSING_ACTION`);
	const action = node.action;
	const [result, setResult] = useState("idle");
	const [pending, setPending] = useState(false);
	const inFlight = useRef(0);
	const latest = useRef(0);
	const [destination, setDestination] = useState("");
	const needsDestination = ["array.insert", "array.move", "array.swap"].includes(action.name);
	return (
		<div data-kalada-action={node.nodeId}>
			{needsDestination && <ActionDestination node={node} view={view} value={destination} change={setDestination} />}
			<button
				ref={(element) => {
					const scope = props.associations.get(node.key)?.scope;
					if (scope && action.name === "array.append") props.focus.append(scope, node.key, element);
				}}
				type="button"
				disabled={action.disabled || (needsDestination && !destination)}
				onClick={(event) => {
					const ticket = props.focus.begin(props.associations.get(node.key), action.name, event.currentTarget);
					const request = ++latest.current;
					inFlight.current++;
					setPending(true);
					void action
						.invoke(needsDestination ? destination : undefined)
						.then(
							(outcome) => {
								if (outcome.status === "applied") props.focus.complete(ticket, outcome.mutation?.revision);
								if (request === latest.current) setResult(`${outcome.path}: ${outcome.status}`);
							},
							() => {
								if (request === latest.current) setResult(`${node.path}: error`);
							},
						)
						.finally(() => {
							inFlight.current--;
							setPending(inFlight.current > 0);
						});
				}}
			>
				{node.label ?? node.nodeId}
			</button>
			<output aria-live="polite">{pending || action.pending() ? "pending" : result}</output>
		</div>
	);
}

function commonProps(node: Node, prefix: string) {
	return {
		nodeId: node.nodeId,
		instanceKey: node.key,
		prefix,
		...(node.presentation ? { presentation: node.presentation } : {}),
	};
}

function renderNode(node: Node, view: View, props: RenderProps): ReactNode {
	const children = () =>
		node.children?.map((child) => <Fragment key={child.key}>{renderNode(child, view, props)}</Fragment>);
	if (node.type === "field" || node.type === "custom") {
		const control = props.index.controls.get(node.key);
		if (!control || control.type !== node.type || control.path !== node.path || control.nodeId !== node.nodeId)
			throw new TypeError(`${node.path}: MISSING_CONTROL`);
		return show(control, props, node.label, node.type === "custom" ? children() : undefined);
	}
	if (node.type === "action") return <ActionButton node={node} view={view} props={props} />;
	if (node.type === "output") {
		const output = props.index.outputs.get(node.key);
		if (!output || output.path !== node.path || output.nodeId !== node.nodeId)
			throw new TypeError(`${node.path}: MISSING_OUTPUT`);
		return (
			<div data-kalada-output={node.nodeId}>
				<KaladaOutput409
					{...commonProps(node, props.prefix)}
					value={output.value}
					format={output.format}
					{...(output.label ? { label: output.label } : {})}
				/>
			</div>
		);
	}
	return renderLayout(node, view, props, children);
}

function renderLayout(node: Node, view: View, props: RenderProps, children: () => ReactNode): ReactNode {
	const common = commonProps(node, props.prefix);
	if (node.type === "group")
		return (
			<KaladaGroup409 {...common} {...(node.label ? { label: node.label } : {})}>
				{children()}
			</KaladaGroup409>
		);
	if (node.type === "section")
		return (
			<KaladaSection409
				{...common}
				{...(node.title ? { title: node.title } : {})}
				{...(node.description ? { description: node.description } : {})}
			>
				{children()}
			</KaladaSection409>
		);
	if (["tabs", "accordion", "repeater"].includes(node.type)) return renderCollection(node, view, props);
	if (node.type === "validation") return <KaladaValidationFeedback node={node} prefix={props.prefix} />;
	return <div data-kalada-node={node.nodeId}>{children()}</div>;
}

function renderCollection(node: Node, view: View, props: RenderProps): ReactNode {
	const common = commonProps(node, props.prefix);
	if (node.type === "tabs" || node.type === "accordion") {
		const items =
			node.items?.map((item) => ({
				id: item.id,
				label: item.label,
				renderChildren: () =>
					item.children.map((child) => <Fragment key={child.key}>{renderNode(child, view, props)}</Fragment>),
			})) ?? [];
		return node.type === "tabs" ? (
			<KaladaTabs409 {...common} items={items} />
		) : (
			<KaladaAccordion409 {...common} items={items} />
		);
	}
	if (node.type === "repeater")
		return (
			<KaladaRepeaterRows409
				nodeId={node.nodeId}
				label={node.label ?? node.nodeId}
				focus={props.focus}
				scopeKey={node.key}
				{...(node.presentation ? { presentation: node.presentation } : {})}
				rows={
					node.rows?.map((row) => ({
						key: row.key,
						renderChildren: () =>
							row.children.map((child) => (
								<Fragment key={child.key}>
									{renderNode(child, view, { ...props, row: { scope: node.key, key: row.key } })}
								</Fragment>
							)),
					})) ?? []
				}
			/>
		);
	return null;
}

/** Host-only React path: no FormApi, positional row binding, Kuery, or implicit adapter. */
export function KaladaFormRenderer(props: KaladaFormRendererProps): ReactElement {
	if (!props?.host || typeof props.host.snapshot !== "function" || typeof props.host.subscribe !== "function")
		throw new TypeError("root: MISSING_STRATEGY");
	const observation = useKaladaHostObservation(props.host);
	const view = useMemo(() => {
		if (!observation.revision) throw new TypeError("root: STALE_INSTALLATION");
		return props.host.snapshot();
	}, [props.host, observation]);
	const [status, setStatus] = useState("idle");
	const index = useMemo(() => indexKaladaView(view), [view]);
	const associations = useMemo(() => associateRepeaters(view.tree), [view.tree]);
	const focus = useRepeaterFocus(props.host, view.revision);
	const prefix = `kalada-${encodeURIComponent(useId())}`;
	const feedback = useMemo(() => validationDescriptions(view.tree, prefix), [view.tree, prefix]);
	const context = useMemo(() => ({ prefix, leases: new CommitLeases() }), [prefix]);
	const form = useRef<HTMLFormElement>(null);
	const summary = useRef<HTMLDivElement>(null);
	useDeniedFocus(status, props.host, view, prefix, form, summary);
	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		context.leases.flush();
		setStatus("submitting");
		void props.host.submit().then(
			(result) => {
				setStatus(result.status);
			},
			() => setStatus("stale"),
		);
	};
	return (
		<KaladaFormContext.Provider value={context}>
			<form ref={form} noValidate data-kalada-v1="" onSubmit={submit}>
				{view.lifecycle ? (
					<output data-kalada-lifecycle="" aria-live="polite">
						{`dirty: ${view.lifecycle.dirty}; touched: ${view.lifecycle.touched}; submitted: ${view.lifecycle.submitted}; valid: ${view.lifecycle.valid}; attempts: ${view.lifecycle.submitCount ?? 0}`}
					</output>
				) : null}
				<KaladaIssueSummary view={view} prefix={prefix} form={form} summary={summary} />
				{renderNode(view.tree, view, { ...props, prefix, index, focus, associations, feedback })}
				<button type="submit">Submit</button>
				<output data-kalada-status="">{status}</output>
			</form>
		</KaladaFormContext.Provider>
	);
}
