import { serialHost } from "../../../../scripts/kalada-preflight/fixtures/row-write-hosts.js";
import type { FsxCompileOptions } from "../types.js";

export function fixture() {
	const host = serialHost();
	const identity = { generation: "g1", fingerprint: "host" };
	const text = { kind: "primitive-type" as const, name: "string" as const };
	const json = { kind: "primitive-type" as const, name: "json" as const };
	const ref = { namespace: "data" as const, segments: ["profile", "name"] };
	const item = (scope: string) => ({
		target: { namespace: "data" as const, scope, segments: [] },
		type: json,
		writable: true as const,
		properties: {
			value: { type: text, writable: true as const },
			quantity: { type: text, writable: true as const },
			nested: { type: json, writable: true as const },
		},
	});
	const options: FsxCompileOptions = {
		profile: "fsx-v1-experimental",
		admission: {
			identity,
			strategy: host.strategy,
			policy: {
				...identity,
				widgets: {},
				actions: {},
				namespaces: { data: "available" },
				renderers: {
					"demo.editor": {
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
						{ path: ref.segments, kind: "value" },
						{ path: ["rows"], kind: "array" },
						{ path: ["rows", { row: "outer" }, "nested"], kind: "array" },
						{ path: ["rows", { row: "outer" }, "nested", { row: "inner" }, "value"], kind: "value" },
						{ path: ["rows", { row: "outer" }, "nested", { row: "inner" }, "quantity"], kind: "value" },
					],
				},
				ui: { availability: "complete", paths: [] },
			},
		},
		references: {
			name: { reference: ref, type: text },
			rowValue: { reference: { namespace: "data", scope: "inner", segments: ["value"] }, type: text },
		},
		locations: {
			name: { target: ref, type: text, writable: true },
			rows: { target: { namespace: "data", segments: ["rows"] }, type: json, writable: true },
		},
		items: { outer: item("outer"), inner: item("inner") },
		renderers: {
			Editor: {
				renderer: "demo.editor",
				props: {
					title: { mode: "literal", expected: "string" },
					current: { mode: "read", expected: "string" },
					edit: { mode: "write", expected: "string" },
				},
			},
		},
	};
	return { host, options };
}
export const source = `<Form id="admin" defaultLanguage="Kalada">
  <Field id="native" widget="text" value={name}/>
  <CUSTOM id="custom" renderer="Editor" title="Edit" current={name} edit={name}/>
  <Output id="echo" value={name}/>
  <Conditional id="condition" condition={name == "custom-value" && true}>
    <Output id="changed" value={"changed"}/>
  </Conditional>
  <Repeater id="rows" value={rows} as="outer">
    <Repeater id="nested" value={outer.nested} as="inner">
      <Field id="row-value" widget="text" value={inner.value}/>
      <Output id="row-echo" value={rowValue}/>
    </Repeater>
  </Repeater>
</Form>`;
