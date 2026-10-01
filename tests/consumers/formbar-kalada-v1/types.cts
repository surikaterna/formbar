import React = require("react");
import ReactDom = require("react-dom/server");
import Declarative = require("@formbar/declarative");
import Schema = require("@formbar/from-schema");
import Renderer = require("@formbar/react-schema");
import Kalada = require("@kalada/core");

const value: Declarative.DefinitionProgram = {
	format: "kalada-program",
	version: 1,
	profile: "kalada-v1",
	expression: { kind: "literal", value: true },
};
declare const options: Declarative.CreateKaladaV1HostOptions;
const host = Declarative.createKaladaV1Host({
	...options,
	definition: { version: 1, id: "typed", root: { type: "output", id: "value", value } },
});
ReactDom.renderToString(React.createElement(Renderer.FormRenderer, { host }));
type Ref = Extract<Declarative.DefinitionProgram["expression"], { kind: "ref" }>["ref"];
const numeric: Declarative.DefinitionProgram = Kalada.KaladaV1.program(
	Kalada.KaladaV1.numericBinary<Ref>("multiply", Kalada.KaladaV1.literal<Ref>(2), Kalada.KaladaV1.literal<Ref>(3)),
);
void numeric;
void Schema.createKaladaSchemaForm;
// @ts-expect-error Retired hook preparation cannot be supplied as a host.
React.createElement(Renderer.FormRenderer, { prepared: {} });
