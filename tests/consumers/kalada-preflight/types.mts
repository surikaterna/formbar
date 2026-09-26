import { type KaladaV1Program, compileKaladaV1Program } from "@kalada/core";
const input: KaladaV1Program = {
	format: "kalada-program",
	version: 1,
	profile: "kalada-v1",
	expression: { kind: "literal", value: true },
};
const result = compileKaladaV1Program(input);
if (!result.ok) throw new Error(result.diagnostic.code);
