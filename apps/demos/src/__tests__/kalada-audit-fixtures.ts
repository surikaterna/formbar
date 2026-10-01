import { createKaladaV1Host } from "@formbar/declarative";
import { literal } from "../demos/kalada-fixture-programs";
import type { PlaygroundDocument } from "../playground/contracts";
import { type DemoLifecycle, installDemo } from "../runtime/kalada-demo-install";
import { schemaValidators } from "../runtime/kalada-demo-schema";
import { createDemoStrategy } from "../runtime/kalada-demo-strategy";

export const auditDocument = {
	version: 2 as const,
	schema: {
		type: "object",
		additionalProperties: false,
		properties: { name: { type: "string", minLength: 3, title: "Name" }, other: { type: "string", title: "Other" } },
	},
	definition: null,
	initialData: { name: "original", other: "same" },
};

export function deferred<T>() {
	let settle: (value: T) => void = () => {
		throw new Error("Missing promise owner");
	};
	const promise = new Promise<T>((resolve) => {
		settle = resolve;
	});
	return { promise, settle };
}

export function installedAudit(lifecycle: DemoLifecycle = {}) {
	return installDemo(auditDocument, undefined, ["formbar.standard.v1"], {}, undefined, lifecycle);
}

export const omissionSchema = {
	type: "object",
	additionalProperties: false,
	properties: { name: { type: "string" }, hidden: { type: "string", minLength: 3 }, show: { type: "boolean" } },
};
export function omissionDocument(include = false) {
	return {
		version: 2 as const,
		schema: omissionSchema,
		initialData: { name: "visible", hidden: "x", show: false },
		definition: {
			version: 1 as const,
			id: "owned-omission",
			submission: { hiddenValues: "omit-inactive" as const },
			root: {
				type: "group" as const,
				id: "root",
				children: [
					{
						type: "field" as const,
						id: "name",
						widget: "text",
						binding: { namespace: "data" as const, segments: ["name"] },
					},
					{
						type: "field" as const,
						id: "hidden",
						widget: "text",
						binding: { namespace: "data" as const, segments: ["hidden"] },
						visible: literal(false),
						...(include ? { submitWhenHidden: "include" as const } : {}),
					},
					{
						type: "field" as const,
						id: "show",
						widget: "checkbox",
						binding: { namespace: "data" as const, segments: ["show"] },
					},
				],
			},
		},
	} satisfies PlaygroundDocument;
}

export function duplicateOmissionHost(submit: Parameters<typeof installDemo>[1]) {
	const document = omissionDocument();
	const schemaValidator = schemaValidators(omissionSchema)[0];
	const identity = { generation: "duplicate-origin", fingerprint: "owned" };
	const paths = ["name", "hidden", "show"].map((name) => ({ path: [name], kind: "value" as const }));
	const fields = Object.fromEntries(
		document.definition.root.children.map((field, index) => [`root.children[${index}]`, field.binding.segments]),
	);
	const store = createDemoStrategy(
		identity,
		paths,
		fields,
		(ref, value) => (ref.path[0] === "show" ? typeof value === "boolean" : typeof value === "string"),
		(data) => {
			if (data && typeof data === "object" && !Array.isArray(data)) submit?.({ ...data });
		},
		{},
		undefined,
		{ definition: document.definition, schemaValidator },
	);
	const writeSources = Object.fromEntries(Object.keys(fields).map((path) => [`${path}.binding`, "value"]));
	const directLocations = Object.fromEntries(
		Object.entries(fields).map(([path, segments]) => [
			`${path}.binding`,
			{
				value: {
					target: { namespace: "data" as const, segments },
					type: { kind: "primitive-type" as const, name: "json" as const },
					writable: true as const,
				},
			},
		]),
	);
	const host = createKaladaV1Host({
		identity,
		strategy: store.strategy,
		definition: document.definition,
		writeSources,
		directLocations,
		policy: {
			...identity,
			widgets: {},
			renderers: {},
			actions: {},
			namespaces: { data: "available" },
			schema: { side: "input", availability: "complete", paths },
			ui: { availability: "complete", paths: [] },
		},
		initialization: { defaults: [], overrides: document.initialData },
		validators: [schemaValidator, schemaValidator],
	});
	return {
		host,
		dispose: () => {
			host.dispose();
			store.revoke();
		},
	};
}
