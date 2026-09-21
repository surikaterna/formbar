import { mock } from "bun:test";
import { workspaceSourceModules } from "./workspace-source-aliases";

const expressions = await import(workspaceSourceModules["@formbar/expressions"]);
mock.module("@formbar/expressions", () => expressions);

const corePath = await import(workspaceSourceModules["@formbar/core/path"]);
const coreTransforms = await import(workspaceSourceModules["@formbar/core/transforms"]);
const coreValidation = await import(workspaceSourceModules["@formbar/core/validation"]);
const core = await import(workspaceSourceModules["@formbar/core"]);
mock.module("@formbar/core", () => core);
mock.module("@formbar/core/path", () => corePath);
mock.module("@formbar/core/transforms", () => coreTransforms);
mock.module("@formbar/core/validation", () => coreValidation);

const declarative = await import(workspaceSourceModules["@formbar/declarative"]);
mock.module("@formbar/declarative", () => declarative);

const fromSchema = await import(workspaceSourceModules["@formbar/from-schema"]);
mock.module("@formbar/from-schema", () => fromSchema);

const react = await import(workspaceSourceModules["@formbar/react"]);
mock.module("@formbar/react", () => react);

const reactSchema = await import(workspaceSourceModules["@formbar/react-schema"]);
mock.module("@formbar/react-schema", () => reactSchema);

const arbiter = await import(workspaceSourceModules["@formbar/arbiter"]);
mock.module("@formbar/arbiter", () => arbiter);
