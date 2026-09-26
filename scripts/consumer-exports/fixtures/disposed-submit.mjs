import { createSchemaForm, jsonSchemaProvider } from "@formbar/from-schema";
import run from "./disposed-submit.cjs";

await run(createSchemaForm, jsonSchemaProvider);
console.log("DISPOSED_SUBMIT esm ok");
