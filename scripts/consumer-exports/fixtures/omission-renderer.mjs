import { createSchemaForm, jsonSchemaProvider } from "@formbar/from-schema";
import { FormRenderer, useSchemaForm } from "@formbar/react-schema";
import React from "react";
import { renderToString } from "react-dom/server";
import { runRenderer } from "./omission-renderer-cases.cjs";

await runRenderer(
	{
		createSchemaForm,
		jsonSchemaProvider,
		FormRenderer,
		useSchemaForm,
		React,
		renderToString,
		loadClient: () => import("react-dom/client"),
	},
	"esm",
);
