import { createKaladaV1Host } from "@formbar/declarative";
import { dataRef, literal } from "../demos/kalada-fixture-programs";
import { installDemo } from "../runtime/kalada-demo-install";
import { schemaValidators } from "../runtime/kalada-demo-schema";
import { createDemoStrategy } from "../runtime/kalada-demo-strategy";

const array = { namespace: "data", segments: ["rows"] };
export function hookAuditHost() {
	return installDemo(
		{
			version: 2,
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					show: { type: "boolean" },
					rows: { type: "array", items: { type: "string", minLength: 3 } },
				},
			},
			initialData: { show: true, rows: ["alpha", "beta"] },
			definition: {
				version: 1,
				id: "hooks",
				root: {
					type: "group",
					id: "root",
					children: [
						{
							type: "field",
							id: "show",
							widget: "checkbox",
							label: "Show editors",
							binding: { namespace: "data", segments: ["show"] },
						},
						{
							type: "conditional",
							id: "editors",
							condition: dataRef("show"),
							// biome-ignore lint/suspicious/noThenProperty: Canonical definition branch data.
							then: [
								{
									type: "repeater",
									id: "rows",
									binding: array,
									scope: "item",
									children: [
										{
											type: "field",
											id: "entry",
											widget: "demo16.rich-select",
											label: "Entry",
											required: literal(true),
											binding: { namespace: "data", segments: [], scope: "item" },
											props: { description: { mode: "literal", value: "Entry guidance" } },
										},
										{ type: "action", id: "move", action: "array.move", target: array, payload: literal({}) },
									],
								},
							],
						},
					],
				},
			},
		},
		undefined,
		["formbar.standard.v1", "demo16.trusted-widgets.v1"],
	);
}

export function readonlyCustomAuditHost() {
	const identity = { generation: "custom-audit", fingerprint: "owned" };
	const schema = { type: "object", properties: { name: { type: "string", minLength: 3 } } };
	const definition = {
		version: 1,
		id: "custom",
		root: {
			type: "custom",
			id: "custom",
			renderer: "test.editor",
			readOnly: literal(true),
			props: {
				current: { mode: "read", expression: dataRef("name") },
				label: { mode: "literal", value: "Read-only custom" },
				description: { mode: "literal", value: "Custom guidance" },
				required: { mode: "literal", value: true },
			},
		},
	};
	const paths = [{ path: ["name"], kind: "value" as const }];
	const store = createDemoStrategy(
		identity,
		paths,
		{ root: ["name"] },
		(_ref, value) => typeof value === "string",
		undefined,
		{},
		undefined,
		{ definition },
	);
	const host = createKaladaV1Host({
		identity,
		definition,
		strategy: store.strategy,
		policy: {
			...identity,
			widgets: {},
			actions: {},
			namespaces: { data: "available" },
			schema: { side: "input", availability: "complete", paths },
			ui: { availability: "complete", paths: [] },
			renderers: {
				"test.editor": {
					children: "forbidden",
					props: {
						current: { modes: ["read"], expected: "string" },
						label: { modes: ["literal"], expected: "string" },
						description: { modes: ["literal"], expected: "string" },
						required: { modes: ["literal"], expected: "boolean" },
					},
				},
			},
		},
		writeSources: {},
		directLocations: {},
		installed: { renderers: new Set(["test.editor"]) },
		initialization: { defaults: [], overrides: { name: "x" } },
		validators: schemaValidators(schema),
	});
	return {
		host,
		dispose: () => {
			host.dispose();
			store.revoke();
		},
	};
}
