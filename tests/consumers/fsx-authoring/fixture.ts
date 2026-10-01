import { createFormRuntime } from "@formbar/declarative";
import { type FsxCompileOptions, compileFsx } from "@formbar/fsx-authoring";
import { installedHost } from "./host.js";

export const source = `<Form id="admin" defaultLanguage="Kalada">
  <Field id="native" widget="text" value={name}/>
  <CUSTOM id="editor" renderer="Editor" title="Name" current={name} edit={name}/>
  <Output id="echo" value={name}/>
  <Conditional id="changed" condition={name == "custom-value" && true}><Output id="message" value={"changed"}/></Conditional>
  <Repeater id="rows" value={rows} as="line">
    <Field id="quantity" widget="text" value={line.quantity}/>
    <CUSTOM id="row-editor" renderer="Editor" title="Quantity" current={quantity} edit={line.quantity}/>
    <Output id="row-echo" value={quantity}/>
  </Repeater>
</Form>`;

export function compilerFixture(compiler = compileFsx, scope = "line", wholeItem = false, location = scope) {
	const ports = installedHost(scope, wholeItem);
	const string = { kind: "primitive-type" as const, name: "string" as const };
	const json = { kind: "primitive-type" as const, name: "json" as const };
	const options: FsxCompileOptions = {
		profile: "fsx-v1-experimental",
		references: {
			name: { reference: { namespace: "data", segments: ["name"] }, type: string },
			quantity: { reference: { namespace: "data", scope, segments: wholeItem ? [] : ["quantity"] }, type: string },
		},
		locations: {
			name: { target: { namespace: "data", segments: ["name"] }, type: string, writable: true },
			rows: { target: { namespace: "data", segments: ["rows"] }, type: json, writable: true },
		},
		items: {
			[scope]: {
				target: { namespace: "data", scope, segments: [] },
				type: wholeItem ? string : json,
				writable: true,
				...(wholeItem ? {} : { properties: { quantity: { type: string, writable: true as const } } }),
			},
		},
		renderers: {
			Editor: {
				renderer: "host.editor",
				props: {
					title: { mode: "literal", expected: "string" },
					current: { mode: "read", expected: "string" },
					edit: { mode: "write", expected: "string" },
				},
			},
		},
		admission: {
			identity: ports.identity,
			strategy: ports.strategy,
			policy: {
				...ports.identity,
				namespaces: { data: "available" },
				widgets: {},
				actions: {},
				renderers: {
					"host.editor": {
						children: "forbidden",
						props: {
							title: { modes: ["literal"], expected: "string" },
							current: { modes: ["read"], expected: "string" },
							edit: { modes: ["write"], expected: "string" },
						},
					},
				},
				schema: {
					side: "input",
					availability: "complete",
					paths: [
						{ path: ["name"], kind: "value" },
						{ path: ["rows"], kind: "array" },
						{ path: ["rows", { row: scope }, ...(wholeItem ? [] : ["quantity"])], kind: "value" },
					],
				},
				ui: { availability: "complete", paths: [] },
			},
		},
	};
	const authored = source
		.replace('as="line"', `as="${scope}"`)
		.replaceAll("line.quantity", wholeItem ? location : `${scope}.quantity`);
	const result = compiler(authored, options);
	if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
	if (Object.values(ports.calls).some((count) => count !== 0))
		throw new Error("Compiler invoked installed runtime callbacks");
	const host = createFormRuntime({ definition: result.validated, installed: { renderers: new Set(["host.editor"]) } });
	return { host, ports, result, options };
}
