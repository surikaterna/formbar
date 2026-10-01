import { snapshotAdmissionPolicy } from "../../../packages/declarative/src/validators/kalada-policy.js";
import {
	compileDefaultKaladaV1Definition,
	createKaladaSchemaForm,
	jsonSchemaProvider,
	projectSchema,
} from "../../../packages/from-schema/src/index.js";
import { generatedHost } from "./generated-host.js";

export const hostSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		profile: { type: "object", additionalProperties: false, properties: { name: { type: "string" } } },
		rows: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					nested: {
						type: "array",
						items: { type: "object", additionalProperties: false, properties: { quantity: { type: "string" } } },
					},
				},
			},
		},
	},
};

type HostOptions = {
	validators?: Parameters<typeof createKaladaSchemaForm>[1]["validators"];
	initialData?: Parameters<typeof createKaladaSchemaForm>[1]["initialData"];
	denyGrant?: boolean;
	omission?: "omit-inactive" | "include-hidden";
	visible?: boolean;
	origin?: { validator: number; source: "schema" | "extension"; path: readonly (string | number)[]; message: string };
	scopedValidators?: Parameters<typeof createKaladaSchemaForm>[1]["scopedValidators"];
};

type HostRoot = {
	children: {
		id: string;
		scope?: string;
		children: {
			id: string;
			scope?: string;
			children: { id: string; scope?: string; children: { id: string; children: { id: string }[] }[] }[];
		}[];
	}[];
};

function hostPolicy(outer: string, inner: string, identity: { generation: string; fingerprint: string }) {
	return snapshotAdmissionPolicy({
		...identity,
		widgets: {},
		renderers: {},
		actions: {},
		namespaces: { data: "available", ui: "available" },
		schema: {
			side: "input",
			availability: "complete",
			paths: [
				{ path: ["profile", "name"], kind: "value" },
				{ path: ["rows"], kind: "array" },
				{ path: ["rows", { row: outer }, "nested"], kind: "array" },
				{ path: ["rows", { row: outer }, "nested", { row: inner }, "quantity"], kind: "value" },
			],
		},
		ui: { availability: "complete", paths: [{ path: ["nameVisible"], kind: "value" }] },
	});
}

function hostBindings(inner: string) {
	return {
		writeSources: {
			"root.children[0].children[0].binding": "profile.name",
			"root.children[1].children[0].children[0].children[0].children[0].binding": "line.quantity",
		},
		directLocations: {
			"root.children[0].children[0].binding": {
				profile: {
					target: { namespace: "data" as const, segments: ["profile"] },
					type: { kind: "primitive-type" as const, name: "json" },
					writable: true,
					properties: { name: { type: { kind: "primitive-type" as const, name: "string" }, writable: true } },
				},
			},
			"root.children[1].children[0].children[0].children[0].children[0].binding": {
				line: {
					target: { namespace: "data" as const, segments: [] as string[], scope: inner },
					type: { kind: "primitive-type" as const, name: "json" },
					writable: true,
					properties: { quantity: { type: { kind: "primitive-type" as const, name: "string" }, writable: true } },
				},
			},
		},
	};
}

function withOmission(
	definition: ReturnType<typeof compileDefaultKaladaV1Definition>,
	omission: HostOptions["omission"],
) {
	const editable = structuredClone(definition);
	const rootWithChildren = editable.root as { children: { children: Record<string, unknown>[] }[] };
	const first = rootWithChildren.children[0]?.children[0];
	if (first)
		first.visible = {
			format: "kalada-program",
			version: 1,
			profile: "kalada-v1",
			expression: { kind: "ref", ref: { namespace: "ui", segments: ["nameVisible"] } },
		};
	if (omission === "include-hidden" && first) first.submitWhenHidden = "include";
	return { ...editable, submission: { hiddenValues: "omit-inactive" as const } };
}

export function validationHost(
	schema: unknown = hostSchema,
	options: HostOptions = {},
	hostFactory: typeof generatedHost = generatedHost,
) {
	const provider = jsonSchemaProvider();
	const definition = compileDefaultKaladaV1Definition(
		projectSchema(options.omission ? hostSchema : schema, { provider, side: "input" }).descriptors,
	);
	const root = definition.root as unknown as HostRoot;
	const outer = root.children[1];
	const inner = outer?.children[0]?.children[0];
	if (!outer?.scope || !inner?.scope) throw Error("expected nested generated rows");
	const namePath = "root.children[0].children[0]";
	const installed = hostFactory(outer.scope, inner.scope, namePath, options.origin);
	installed.setHidden(!options.visible);
	if (options.omission === "include-hidden") installed.setInclude(true);
	const identity = { generation: "g1", fingerprint: "host" };
	const policy = hostPolicy(outer.scope, inner.scope, identity);
	const settings = {
		provider,
		side: "input" as const,
		identity,
		policy: options.denyGrant ? { ...policy, fingerprint: "revoked" } : policy,
		strategy: installed.strategy,
		...hostBindings(inner.scope),
		...(options.validators ? { validators: options.validators } : {}),
		...(options.scopedValidators ? { scopedValidators: options.scopedValidators } : {}),
		...(options.initialData !== undefined ? { initialData: options.initialData } : {}),
	};
	const result = createKaladaSchemaForm(schema, {
		...settings,
		...(options.omission ? { definition: withOmission(definition, options.omission) } : {}),
	});
	return {
		...result,
		installed,
		nameId: root.children[0]?.children[0]?.id,
		quantityId: inner.children[0]?.children[0]?.id,
	};
}
