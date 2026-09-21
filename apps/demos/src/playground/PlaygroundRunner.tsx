import { CompilationPreview } from "../renderers/CompilationPreview";
import type { PlaygroundDocument } from "./contracts";

export function PlaygroundRunner({ document }: { readonly document: PlaygroundDocument }) {
	return (
		<CompilationPreview
			schema={document.schema}
			{...(document.definition ? { definition: document.definition } : {})}
			initialData={document.initialData}
		/>
	);
}
