import { describe, expect, it } from "vitest";
import * as api from "../index.js";
import type {
	CustomNodeRegistration,
	ExtensionPolicy,
	ExtensionProps,
	RendererContext,
	RendererDiagnostic,
	RendererExtensions,
	WidgetA11y,
	WidgetBinding,
	WidgetConstraints,
	WidgetMetadata,
	WidgetOption,
	WidgetProps,
	WidgetRegistration,
} from "../index.js";

type PublicExtensionTypes = [
	ExtensionProps,
	ExtensionPolicy,
	WidgetBinding,
	WidgetConstraints,
	WidgetOption,
	WidgetMetadata,
	WidgetA11y,
	WidgetProps,
	RendererContext,
	WidgetRegistration,
	CustomNodeRegistration,
	RendererExtensions,
	RendererDiagnostic,
];

const publicExtensionTypesCompile: PublicExtensionTypes | undefined = undefined;

describe("react-schema public API", () => {
	it("exports only the lean renderer surface without registry or legacy aliases", () => {
		expect(publicExtensionTypesCompile).toBeUndefined();
		expect(Object.keys(api).sort()).toEqual(["FormRenderer", "useSchemaForm"]);
		for (const forbidden of [
			"renderLayoutTree",
			"FieldRenderer",
			"RendererRegistry",
			"resolveFieldStates",
			"pruneHiddenFields",
		])
			expect(api).not.toHaveProperty(forbidden);
	});
});
