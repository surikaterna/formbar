import * as arbiter from "@formbar/arbiter";
import * as core from "@formbar/core";
import * as path from "@formbar/core/path";
import * as transforms from "@formbar/core/transforms";
import * as validation from "@formbar/core/validation";
import * as declarative from "@formbar/declarative";
import * as expressions from "@formbar/expressions";
import * as fromSchema from "@formbar/from-schema";
import * as react from "@formbar/react";
import * as reactSchema from "@formbar/react-schema";
const scoped: fromSchema.DefinitionFieldValidator<{ name: string }, object> = {
	fieldId: "name-field",
	validate: ({ data, field }) => [
		{ code: String(data.name.length), message: field.instance.nodeId, severity: "error" },
	],
};
export { scoped };
export { expressions, core, path, transforms, validation, declarative, fromSchema, react, arbiter, reactSchema };
