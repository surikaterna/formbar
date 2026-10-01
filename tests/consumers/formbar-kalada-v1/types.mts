import {
	type CreateKaladaV1HostOptions,
	type DefinitionProgram,
	type FormDefinition,
	createKaladaV1Host,
} from "@formbar/declarative";
import {
	compileDefaultKaladaV1Definition,
	createKaladaSchemaForm,
	jsonSchemaProvider,
	projectSchema,
} from "@formbar/from-schema";
import { FormRenderer } from "@formbar/react-schema";
import { KaladaV1 } from "@kalada/core";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

const value: DefinitionProgram = {
	format: "kalada-program",
	version: 1,
	profile: "kalada-v1",
	expression: { kind: "literal", value: true },
};
const definition: FormDefinition = { version: 1, id: "typed", root: { type: "output", id: "value", value } };
type Ref = Extract<DefinitionProgram["expression"], { kind: "ref" }>["ref"];
const numeric = KaladaV1.numericBinary<Ref>("multiply", KaladaV1.literal<Ref>(2), KaladaV1.literal<Ref>(3));
const canonical: DefinitionProgram = KaladaV1.program(numeric);
declare const options: CreateKaladaV1HostOptions;
const host = createKaladaV1Host({ ...options, definition });
renderToString(createElement(FormRenderer, { host }));
compileDefaultKaladaV1Definition(
	projectSchema({ type: "string" }, { provider: jsonSchemaProvider(), side: "input" }).descriptors,
);
void createKaladaSchemaForm;
void canonical;
// @ts-expect-error A legacy expression is not a canonical public program.
const legacy: DefinitionProgram = { kind: "op", op: "mul", args: [] };
void legacy;
