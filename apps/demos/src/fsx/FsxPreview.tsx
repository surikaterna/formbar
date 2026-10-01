import type { KaladaV1Host } from "@formbar/declarative";
import { FormRenderer } from "@formbar/react-schema";
import { useCallback, useState } from "react";
import { PreviewErrorBoundary } from "../playground/PreviewErrorBoundary";
import type { PlaygroundDocument } from "../playground/contracts";
import { useDemoHostChannel } from "../renderers/use-demo-host-channel";
import { type DemoInstaller, useDemoInstallation } from "../renderers/use-demo-installation";
import { captureDemoDraft } from "../runtime/kalada-demo-install";
import { kaladaDemoRenderers, kaladaDemoWidgets } from "../runtime/kalada-demo-widgets";
import { installFsxDocument } from "./compile";

function useObservation(publish: (host: KaladaV1Host) => () => void, document: PlaygroundDocument) {
	const [data, setData] = useState<unknown>(document.initialData);
	const [error, setError] = useState<string | undefined>(undefined);
	const observe = useCallback(
		(host: KaladaV1Host) => {
			let active = true;
			const update = () => {
				if (!active) return;
				try {
					setData(captureDemoDraft(host, document.schema).data);
					host.snapshot();
					setError(undefined);
				} catch (error) {
					setError(error instanceof Error ? error.message : "Preview evaluation failed");
				}
			};
			update();
			const unsubscribe = host.subscribe(update);
			const retire = publish(host);
			return () => {
				active = false;
				unsubscribe();
				retire();
			};
		},
		[publish, document],
	);
	return { data, error, observe };
}

export function FsxPreview(props: {
	readonly document: PlaygroundDocument;
	readonly onHost: (host: KaladaV1Host) => () => void;
	readonly owner?: object;
}) {
	const [submission, setSubmission] = useState<Readonly<Record<string, unknown>> | null>(null);
	const submit = useCallback((data: Readonly<Record<string, unknown>>) => setSubmission(structuredClone(data)), []);
	const installer = useCallback<DemoInstaller>(
		(input, publish) => installFsxDocument(input.document, publish, props.owner),
		[props.owner],
	);
	const installed = useDemoInstallation({ document: props.document }, submit, installer);
	const observation = useObservation(props.onHost, props.document);
	useDemoHostChannel(installed.host, observation.observe);
	const [reset, setReset] = useState(0);
	return (
		<section aria-label="Applied FSX preview" className="schema-demo-form mt-6">
			{installed.error || observation.error ? (
				<p role="alert">FSX preview: {installed.error ?? observation.error}. Editors and Reset remain available.</p>
			) : null}
			<PreviewErrorBoundary key={reset}>
				{installed.host ? (
					<FormRenderer host={installed.host} widgets={kaladaDemoWidgets} renderers={kaladaDemoRenderers} />
				) : null}
			</PreviewErrorBoundary>
			<button
				type="button"
				onClick={() => {
					installed.host?.reset();
					setReset(reset + 1);
					setSubmission(null);
				}}
			>
				Reset
			</button>
			<section aria-label="Last successful submission">
				<h2>Last successful submission</h2>
				{submission ? <pre>{JSON.stringify(submission, null, 2)}</pre> : <p>No successful submission yet.</p>}
			</section>
			<h2>Current data</h2>
			<pre aria-label="Current data">{JSON.stringify(observation.data, null, 2)}</pre>
		</section>
	);
}
