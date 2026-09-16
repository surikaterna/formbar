import { mock } from "bun:test";

import * as corePath from "../packages/core/src/path.entry.ts";
import * as coreTransforms from "../packages/core/src/transforms.entry.ts";
import * as coreValidation from "../packages/core/src/validation.entry.ts";
import * as expressions from "../packages/expressions/src/index.ts";

mock.module("@formbar/expressions", () => expressions);

const core = await import("../packages/core/src/index.ts");
mock.module("@formbar/core", () => core);
mock.module("@formbar/core/path", () => corePath);
mock.module("@formbar/core/transforms", () => coreTransforms);
mock.module("@formbar/core/validation", () => coreValidation);

const fromSchema = await import("../packages/from-schema/src/index.ts");
mock.module("@formbar/from-schema", () => fromSchema);

const react = await import("../packages/react/src/index.ts");
mock.module("@formbar/react", () => react);

const reactSchema = await import("../packages/react-schema/src/index.ts");
mock.module("@formbar/react-schema", () => reactSchema);

const arbiter = await import("../packages/arbiter/src/index.ts");
mock.module("@formbar/arbiter", () => arbiter);
