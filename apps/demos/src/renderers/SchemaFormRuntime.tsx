import type { KaladaV1Host } from "@formbar/declarative";
import { FormRenderer } from "@formbar/react-schema";
import { useCallback, useRef, useState } from "react";
import type { TrustedRuntimeProfileId } from "../demos/baseline-contracts";
import type { PlaygroundDocument, PlaygroundExample } from "../playground/contracts";
import { kaladaDemoRenderers, kaladaDemoWidgets } from "../runtime/kalada-demo-widgets";
import { useDemoHostChannel } from "./use-demo-host-channel";
import { useDemoInstallation } from "./use-demo-installation";

export interface SchemaFormRuntimeProps {
	readonly document: PlaygroundDocument;
	readonly profileIds?: readonly TrustedRuntimeProfileId[];
	readonly initialUiState?: Readonly<Record<string, unknown>>;
	readonly arbiterRules?: PlaygroundExample["runtime"]["arbiterRules"];
	readonly actionControls?: "host" | "definition";
	readonly onSubmit?: (payload: Readonly<Record<string, unknown>>) => void;
	readonly showObservability?: boolean;
	readonly onHost?: (host: KaladaV1Host) => () => void;
}

export function SchemaFormRuntime(props: SchemaFormRuntimeProps) {
	const [submission, setSubmission] = useState<Readonly<Record<string, unknown>> | null>(null);
	const onSubmit = useRef(props.onSubmit);
	onSubmit.current = props.onSubmit;
	const submit = useCallback((data: Readonly<Record<string, unknown>>) => {
		const snapshot = freezeSnapshot(data);
		setSubmission(snapshot);
		onSubmit.current?.(snapshot);
	}, []);
	const installed = useDemoInstallation(props, submit);
	useDemoHostChannel(installed.host, props.onHost);
	if (!installed.host)
		return installed.error ? (
			<section role="alert" className="schema-demo-form mt-6 rounded-lg border border-destructive p-5">
				<h2 className="font-semibold">{installed.error}</h2>
			</section>
		) : (
			<section aria-live="polite">Preparing rule-governed form</section>
		);
	return (
		<section className="schema-demo-form mt-6">
			<FormRenderer host={installed.host} widgets={kaladaDemoWidgets} renderers={kaladaDemoRenderers} />
			<button type="button" onClick={() => installed.host?.reset()}>
				Reset
			</button>
			{props.showObservability ? (
				<section aria-label="Last successful submission">
					<h2>Last successful submission</h2>
					{submission ? <pre>{JSON.stringify(submission, null, 2)}</pre> : <p>No successful submission yet.</p>}
				</section>
			) : null}
		</section>
	);
}

function freezeSnapshot(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
	const copy = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
	const freeze = (node: unknown): void => {
		if (!node || typeof node !== "object") return;
		for (const child of Object.values(node)) freeze(child);
		Object.freeze(node);
	};
	freeze(copy);
	return copy;
}
