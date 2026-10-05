import type { FsxDiagnostic, FsxDiagnosticLocation } from "@formbar/fsx-authoring";
import type { RefObject } from "react";
import type { FsxSourceHandle } from "./FsxSourceEditor";
import { type SourceDiagnosticReport, sourceLocationRange } from "./source-diagnostics";

function LocationDetails({ location, code }: { readonly location: FsxDiagnosticLocation; readonly code?: string }) {
	return (
		<details>
			<summary>Diagnostic details</summary>
			{code ? <span>{code} — </span> : null}
			{location.path} {location.range ? `UTF-16 [${location.range.start}, ${location.range.end})` : "(no source range)"}
		</details>
	);
}

export function FsxDiagnostics(props: {
	readonly diagnostics: readonly FsxDiagnostic[];
	readonly editor: RefObject<FsxSourceHandle | null>;
	readonly report?: SourceDiagnosticReport;
}) {
	const select = (location: FsxDiagnosticLocation) => {
		if (!sourceLocationRange(props.report, location) || !location.range || !props.editor.current) return;
		props.editor.current.select(location.range.start, location.range.end);
	};
	return (
		<ul aria-label="Source diagnostics">
			{props.diagnostics.map((diagnostic, index) => (
				<li key={`${index}-${diagnostic.code}`}>
					<button
						type="button"
						onClick={() => select(diagnostic)}
						disabled={!sourceLocationRange(props.report, diagnostic)}
					>
						{diagnostic.message}
					</button>
					<LocationDetails location={diagnostic} code={diagnostic.code} />
					{diagnostic.related?.map((location, index) => (
						<div key={`${index}-${location.path}`}>
							<button
								type="button"
								onClick={() => select(location)}
								disabled={!sourceLocationRange(props.report, location)}
							>
								{location.message}
							</button>
							<LocationDetails location={location} />
						</div>
					))}
				</li>
			))}
		</ul>
	);
}
