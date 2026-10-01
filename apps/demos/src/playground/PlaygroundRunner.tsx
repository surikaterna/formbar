import { SchemaFormRuntime } from "../renderers/SchemaFormRuntime";
import type { SchemaFormRuntimeProps } from "../renderers/SchemaFormRuntime";
import type { PlaygroundExample } from "./contracts";
import type { PlaygroundRuntimeContext } from "./runtime-context";

export function PlaygroundRunner(props: {
	readonly document: PlaygroundExample["document"];
	readonly runtime: PlaygroundRuntimeContext;
	readonly previewData?: PlaygroundExample["document"]["initialData"];
	readonly onHost?: SchemaFormRuntimeProps["onHost"];
}) {
	return (
		<SchemaFormRuntime
			document={props.previewData ? { ...props.document, initialData: props.previewData } : props.document}
			profileIds={props.runtime.profileIds}
			initialUiState={props.runtime.initialUiState}
			arbiterRules={props.runtime.arbiterRules}
			actionControls={props.runtime.actionControls}
			showObservability
			onHost={props.onHost}
		/>
	);
}
