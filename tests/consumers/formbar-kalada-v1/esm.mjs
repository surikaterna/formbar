import * as declarative from "@formbar/declarative";
import * as schema from "@formbar/from-schema";
import * as renderer from "@formbar/react-schema";
import * as React from "react";
import * as server from "react-dom/server";
import run from "./case.cjs";

await run({ declarative, schema, renderer, React, server });
