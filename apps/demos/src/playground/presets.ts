import { compilationPreviewSchema } from "../demos/01-compilation-preview";
import { type DemoCompatibility, PLAYGROUND_DOCUMENT_VERSION, type PlaygroundDocument } from "./contracts";

const compilationDocument: PlaygroundDocument = {
	version: PLAYGROUND_DOCUMENT_VERSION,
	schema: compilationPreviewSchema,
	definition: null,
	initialData: { name: "", email: "", tags: [] },
};

export const compatibilityMatrix: readonly DemoCompatibility[] = [
	{
		demoId: "schema-compilation",
		support: "full",
		presets: [
			{
				key: "schema-compilation:default",
				demoId: "schema-compilation",
				variant: "default",
				label: "Default",
				support: "full",
				document: compilationDocument,
			},
		],
	},
];

export function getCompatibility(demoId: string): DemoCompatibility {
	return compatibilityMatrix.find((entry) => entry.demoId === demoId) ?? compatibilityMatrix[0];
}

export function getPreset(demoId: string, variant?: string) {
	const compatibility = getCompatibility(demoId);
	return compatibility.presets.find((preset) => preset.variant === variant) ?? compatibility.presets[0];
}
