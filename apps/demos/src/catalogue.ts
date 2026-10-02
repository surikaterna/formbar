import { demos } from "./demos/registry";
import { fsxExamples } from "./fsx/registry";

export const catalogue = [
	...demos.map((demo) => ({
		kind: "schema" as const,
		id: demo.id,
		title: demo.title,
		subtitle: demo.subtitle,
		category: demo.category,
		registration: demo,
	})),
	...fsxExamples.map((example) => ({
		kind: "fsx" as const,
		id: `fsx-${example.id}`,
		title: example.title,
		subtitle: "Experimental FSX · live writable preview",
		category: "FSX (experimental)",
		example,
	})),
];

export const catalogueIds = catalogue.map(({ id }) => id);
