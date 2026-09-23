import { SchemaFormRuntime } from "../renderers/SchemaFormRuntime";
import type { PlaygroundExample } from "./contracts";

export function PlaygroundRunner(props: {
	readonly document: PlaygroundExample["document"];
	readonly runtime: PlaygroundExample["runtime"];
}) {
	return (
		<SchemaFormRuntime
			document={props.document}
			profileIds={props.runtime.profileIds}
			initialUiState={props.runtime.initialUiState}
			arbiterRules={props.runtime.arbiterRules}
			actionControls={props.runtime.actionControls}
			showObservability
		/>
	);
}
