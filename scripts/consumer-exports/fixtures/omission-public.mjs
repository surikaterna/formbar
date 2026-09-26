import { createForm } from "@formbar/core";
import { createSchemaForm, jsonSchemaProvider } from "@formbar/from-schema";
import { run } from "./omission-cases.cjs";

await run({ createSchemaForm, jsonSchemaProvider, createForm }, "esm");
