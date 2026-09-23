import type { ActionNode, ResolvedActionState } from "@formbar/declarative";
import { fieldId } from "@formbar/react";
import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import type { layoutProps } from "./renderer-elements.js";
import { domIdToken } from "./renderer-evidence.js";
import type { RendererEnvironment } from "./renderer-types.js";
import { bindingKey } from "./repeater-coordinator.js";
import { useActionObservation } from "./use-action-executor.js";

interface ActionNodeProps {
	readonly node: ActionNode;
	readonly state: ResolvedActionState;
	readonly environment: RendererEnvironment;
	readonly layout: ReturnType<typeof layoutProps>;
}

export function ActionNodeView({ node, state, environment, layout }: ActionNodeProps): ReactElement {
	const control = useActionControl(node, state, environment);
	return (
		<div data-formbar-node={node.id} data-formbar-action={state.action} {...layout.attributes} style={layout.style}>
			<ActionButton node={node} state={state} control={control} />
			{control.showStatus ? <ActionStatus node={node} state={state} control={control} /> : null}
		</div>
	);
}

function useActionControl(node: ActionNode, state: ResolvedActionState, environment: RendererEnvironment) {
	const execution = useActionObservation(environment.actions, state.instance.instanceKey);
	const submit = state.action === "submit";
	const diagnostic = execution.availability ?? execution.diagnostic;
	const showStatus = !submit;
	const statusId = fieldId(`${domIdToken(state.instance.instanceKey)}-action-status`, environment.prefix);
	const softBoundary = execution.availability === "array-boundary";
	const disabled =
		(execution.availability !== undefined && !softBoundary) ||
		!state.visible ||
		state.disabled ||
		state.readOnly ||
		(execution.status === "pending" && state.concurrency === "drop");
	const item = state.instance.scopes.at(-1)?.index;
	const button = useRef<HTMLButtonElement>(null);
	const targetKey = state.target ? bindingKey(state.target) : undefined;
	const owner = environment.repeaterOwner;
	useEffect(() => {
		if (state.action !== "array.append" || !owner || owner.bindingKey !== targetKey || !button.current) return;
		return environment.repeaters.registerAppend(owner, button.current);
	}, [environment.repeaters, owner, state.action, targetKey]);
	const label = node.label ?? state.action;
	const accessibleLabel =
		state.action.startsWith("array.") && item !== undefined ? `${label}, item ${item + 1}` : label;
	const execute = async () => {
		if (execution.availability !== undefined) return;
		const intent = environment.repeaters.begin(state, node.id, owner);
		const result = await environment.actions.execute(state.instance.instanceKey);
		environment.repeaters.finish(intent, result.status === "completed");
	};
	return {
		accessibleLabel,
		button,
		diagnostic,
		disabled,
		execute,
		execution,
		label,
		showStatus,
		softBoundary,
		statusId,
	};
}

function ActionButton(props: {
	readonly node: ActionNode;
	readonly state: ResolvedActionState;
	readonly control: ReturnType<typeof useActionControl>;
}): ReactElement {
	const { control, node, state } = props;
	return (
		<button
			ref={control.button}
			type="button"
			disabled={control.disabled}
			aria-disabled={control.softBoundary || undefined}
			aria-busy={control.execution.status === "pending" || undefined}
			aria-describedby={control.showStatus ? control.statusId : undefined}
			data-formbar-instance={state.instance.instanceKey}
			data-formbar-action-node={node.id}
			{...(state.target ? { "data-formbar-array-target": bindingKey(state.target) } : {})}
			{...(state.action.startsWith("array.") ? { "data-formbar-array-operation": state.action } : {})}
			aria-label={control.accessibleLabel}
			onClick={() => void control.execute()}
		>
			{control.label}
		</button>
	);
}

function ActionStatus(props: {
	readonly node: ActionNode;
	readonly state: ResolvedActionState;
	readonly control: ReturnType<typeof useActionControl>;
}): ReactElement {
	return (
		<output
			id={props.control.statusId}
			data-formbar-action={props.state.action}
			data-formbar-node={props.node.id}
			data-formbar-instance={props.state.instance.instanceKey}
			{...(props.control.diagnostic ? { "data-formbar-diagnostic": props.control.diagnostic } : {})}
		>
			{statusText(props.control.execution.status, props.control.execution.availability !== undefined)}
		</output>
	);
}

function statusText(status: string, diagnostic: boolean): string {
	if (diagnostic) return "Action unavailable.";
	if (status === "pending") return "Action in progress.";
	if (status === "succeeded") return "Action completed.";
	if (status === "failed") return "Action failed.";
	return "";
}
