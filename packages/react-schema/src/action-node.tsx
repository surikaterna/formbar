import type { ActionNode, ResolvedActionState } from "@formbar/declarative";
import { fieldId } from "@formbar/react";
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
	const label = node.label ?? state.action;
	const accessibleLabel =
		state.action.startsWith("array.") && item !== undefined ? `${label}, item ${item + 1}` : label;
	const execute = async () => {
		if (execution.availability !== undefined) return;
		const intent = environment.repeaters.begin(state, node.id);
		const result = await environment.actions.execute(state.instance.instanceKey);
		environment.repeaters.finish(intent, result.status === "completed");
	};
	return (
		<div data-formbar-node={node.id} data-formbar-action={state.action} {...layout.attributes} style={layout.style}>
			<button
				type="button"
				disabled={disabled}
				aria-disabled={softBoundary || undefined}
				aria-busy={execution.status === "pending" || undefined}
				aria-describedby={showStatus ? statusId : undefined}
				data-formbar-instance={state.instance.instanceKey}
				data-formbar-action-node={node.id}
				{...(state.target ? { "data-formbar-array-target": bindingKey(state.target) } : {})}
				aria-label={accessibleLabel}
				onClick={() => void execute()}
			>
				{label}
			</button>
			{showStatus ? (
				<output
					id={statusId}
					data-formbar-action={state.action}
					data-formbar-node={node.id}
					data-formbar-instance={state.instance.instanceKey}
					{...(diagnostic ? { "data-formbar-diagnostic": diagnostic } : {})}
				>
					{statusText(execution.status, execution.availability !== undefined)}
				</output>
			) : null}
		</div>
	);
}

function statusText(status: string, diagnostic: boolean): string {
	if (diagnostic) return "Action unavailable.";
	if (status === "pending") return "Action in progress.";
	if (status === "succeeded") return "Action completed.";
	if (status === "failed") return "Action failed.";
	return "";
}
