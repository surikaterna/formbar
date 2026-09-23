import type { ActionNode, ResolvedActionState } from "@formbar/declarative";
import { fieldId } from "@formbar/react";
import type { ReactElement } from "react";
import type { layoutProps } from "./renderer-elements.js";
import { domIdToken } from "./renderer-evidence.js";
import type { RendererEnvironment } from "./renderer-types.js";
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
	const disabled =
		execution.availability !== undefined ||
		!state.visible ||
		state.disabled ||
		state.readOnly ||
		environment.form.isSubmitting() ||
		(execution.status === "pending" && state.concurrency === "drop");
	return (
		<div data-formbar-node={node.id} data-formbar-action={state.action} {...layout.attributes} style={layout.style}>
			<button
				type="button"
				disabled={disabled}
				aria-busy={execution.status === "pending" || undefined}
				aria-describedby={showStatus ? statusId : undefined}
				data-formbar-instance={state.instance.instanceKey}
				onClick={() => void environment.actions.execute(state.instance.instanceKey)}
			>
				{node.label ?? state.action}
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
